// Polling safety net: webhooks never fire for many comments. Acts only on
// recent keyword matches with no owner reply, capped per sweep (error 368).

import { MAX_COMMENT_SEND_ATTEMPTS } from "@/lib/queue/comment-delivery";
import { hasLegacyUnconfirmedDelivery } from "@/lib/instagram/delivery-errors";
import { prisma } from "@/lib/db/client";
import { getDMQueue } from "@/lib/queue/client";
import {
  createInstagramContext,
  getRecentMediaComments,
  getUserMedia,
  MetaApiError,
  type InstagramComment,
  type InstagramContext,
} from "@/lib/instagram/provider";
import { matchKeywords } from "@/lib/utils/keyword-matcher";

// Older comments are outside Instagram's private-reply window anyway.
const LOOKBACK_HOURS = Number(process.env.COMMENT_POLL_LOOKBACK_HOURS ?? 72);
// A viral post drains gradually instead of bursting into the comment API.
const MAX_NEW_PER_SWEEP = Number(process.env.COMMENT_POLL_MAX_PER_SWEEP ?? 30);
const RECENT_MEDIA_LIMIT = 10;

interface SweepStat {
  campaign: string;
  keywords: string;
  matched: number;
  alreadyReplied: number;
  enqueued: number;
  errors: string[];
}

function errMessage(error: unknown): string {
  if (error instanceof MetaApiError)
    return `Meta ${error.code}: ${error.message}`;
  if (error instanceof Error) return error.message;
  return "Unknown error";
}

export async function reconcileComments(): Promise<void> {
  const automations = await prisma.automation.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      postId: true,
      matchAnyPost: true,
      matchAnyWord: true,
      keywords: true,
      wholeWordMatch: true,
      publicReplyEnabled: true,
      workspaceId: true,
      instagramAccount: {
        select: {
          id: true,
          instagramId: true,
          username: true,
          accessToken: true,
          provider: true,
          workspaceId: true,
          zernioAccountId: true,
        },
      },
    },
  });

  const sinceMs = Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000;
  const tokenCache = new Map<string, InstagramContext | null>();

  for (const automation of automations) {
    const stat = await sweepCampaign({ automation, sinceMs, tokenCache }).catch(
      (error): SweepStat => ({
        campaign: automation.name,
        keywords: automation.keywords.join(","),
        matched: 0,
        alreadyReplied: 0,
        enqueued: 0,
        errors: [errMessage(error)],
      })
    );
    await recordSweep(automation.workspaceId, stat);
  }
}

async function sweepCampaign({
  automation,
  sinceMs,
  tokenCache,
}: {
  automation: {
    id: string;
    name: string;
    postId: string | null;
    matchAnyPost: boolean;
    matchAnyWord: boolean;
    keywords: string[];
    wholeWordMatch: boolean;
    publicReplyEnabled: boolean;
    instagramAccount: {
      id: string;
      instagramId: string;
      username: string;
      accessToken: string;
      provider: "META" | "ZERNIO";
      workspaceId: string;
      zernioAccountId: string | null;
    };
  };
  sinceMs: number;
  tokenCache: Map<string, InstagramContext | null>;
}): Promise<SweepStat> {
  const account = automation.instagramAccount;
  const stat: SweepStat = {
    campaign: automation.name,
    keywords: automation.matchAnyWord
      ? "(any word)"
      : automation.keywords.join(","),
    matched: 0,
    alreadyReplied: 0,
    enqueued: 0,
    errors: [],
  };

  let accessToken = tokenCache.get(account.id);
  if (accessToken === undefined) {
    try {
      accessToken = await createInstagramContext(account);
    } catch {
      accessToken = null;
    }
    tokenCache.set(account.id, accessToken);
  }
  if (!accessToken) {
    stat.errors.push("Failed to decrypt access token");
    return stat;
  }

  const mediaIds: string[] = [];
  if (automation.postId) {
    mediaIds.push(automation.postId);
    mediaIds.push(...(await adMediaFor(automation.postId)));
  } else if (automation.matchAnyPost) {
    try {
      const media = await getUserMedia({
        context: accessToken,
        limit: RECENT_MEDIA_LIMIT,
      });
      mediaIds.push(...media.map((m) => m.id));
    } catch (error) {
      stat.errors.push(`Media list: ${errMessage(error)}`);
    }
  }
  if (mediaIds.length === 0) return stat;

  const queue = getDMQueue();

  for (const mediaId of mediaIds) {
    let comments: InstagramComment[];
    try {
      comments = await getRecentMediaComments({
        context: accessToken,
        mediaId,
        sinceMs,
      });
    } catch (error) {
      stat.errors.push(`Comments ${mediaId}: ${errMessage(error)}`);
      continue;
    }

    const needsAction = comments.filter((c) => {
      const authorId = c.from?.id;
      if (!authorId || authorId === account.instagramId) return false;

      const matched = automation.matchAnyWord
        ? true
        : matchKeywords(
            c.text ?? "",
            automation.keywords,
            automation.wholeWordMatch
          ).matched;
      if (!matched) return false;
      stat.matched += 1;

      const ownerReplied = (c.replies?.data ?? []).some(
        (r) => r.from?.id === account.instagramId
      );
      if (ownerReplied) {
        stat.alreadyReplied += 1;
        return false;
      }
      return true;
    });
    if (needsAction.length === 0) continue;

    // Skip fully handled comments. With a public reply, a sent DM alone is not
    // enough, so a comment whose reply failed comes back to retry it.
    const logs = await prisma.dmLog.findMany({
      where: {
        automationId: automation.id,
        commentId: { in: needsAction.map((c) => c.id) },
      },
      select: {
        commentId: true, status: true, attempts: true, errorMessage: true,
        dmDeliveryUnconfirmed: true, publicReplySentAt: true,
        publicReplyDeliveryUnconfirmed: true,
      },
    });
    const handledSet = new Set(logs.filter((log) => {
      const dmStopped = log.status === "SENT" || log.status === "SKIPPED_PLAN_LIMIT" ||
        log.dmDeliveryUnconfirmed || log.attempts >= MAX_COMMENT_SEND_ATTEMPTS ||
        (log.status === "FAILED" && hasLegacyUnconfirmedDelivery(log.errorMessage));
      const replyStopped = !automation.publicReplyEnabled ||
        log.publicReplySentAt || log.publicReplyDeliveryUnconfirmed;
      return dmStopped && replyStopped;
    }).map((log) => log.commentId));

    const fresh = needsAction
      .filter((c) => !handledSet.has(c.id))
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
      .slice(0, MAX_NEW_PER_SWEEP);

    for (const c of fresh) {
      // No deterministic jobId: a retained earlier job would silently drop this
      // add. Dedup is above and in the worker's durable per-leg claims.
      await queue.add("process-comment", {
        instagramAccountId: account.instagramId,
        accountConnectionId: account.id,
        commentId: c.id,
        commentText: c.text ?? "",
        commenterId: c.from!.id,
        commenterName: c.from?.username,
        mediaId,
        // For an ad, the campaign is bound to the source post; without this the
        // worker matches nothing and the sweep re-enqueues it forever.
        originalMediaId:
          automation.postId && mediaId !== automation.postId
            ? automation.postId
            : undefined,
        source: "POLLING",
      });
      stat.enqueued += 1;
    }
  }

  return stat;
}

// Ad copies of a post, recovered from received webhooks (the ads API would need
// ads_management). An ad is only visible once one of its comments has arrived.
export async function adMediaFor(postId: string): Promise<string[]> {
  try {
    const rows = await prisma.$queryRaw<{ mediaId: string | null }[]>`
      SELECT DISTINCT change->'value'->'media'->>'id' AS "mediaId"
      FROM "WebhookEvent" w,
           jsonb_array_elements(w.payload::jsonb->'entry') entry,
           jsonb_array_elements(entry->'changes') change
      WHERE change->>'field' = 'comments'
        AND change->'value'->'media'->>'original_media_id' = ${postId}
        AND w."createdAt" > now() - interval '90 days'
    `;
    return rows
      .map((r) => r.mediaId)
      .filter((id): id is string => Boolean(id) && id !== postId);
  } catch {
    return [];
  }
}

async function recordSweep(
  workspaceId: string,
  stat: SweepStat
): Promise<void> {
  if (stat.enqueued === 0 && stat.errors.length === 0) return;

  await prisma.operationalEvent
    .create({
      data: {
        workspaceId,
        source: "SYSTEM",
        level: stat.errors.length > 0 ? "WARNING" : "INFO",
        message: `Comment sweep "${stat.campaign}" [${stat.keywords}]: ${stat.enqueued} enqueued, ${stat.matched} matched, ${stat.alreadyReplied} already replied`,
        payload: { ...stat },
      },
    })
    .catch(() => {});
}
