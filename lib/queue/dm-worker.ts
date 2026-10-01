import {
  classifySendError,
  hasLegacyUnconfirmedDelivery,
  isConfirmedSendRejection,
  isDeliveryUnconfirmed,
} from "@/lib/instagram/delivery-errors";
import { claimCommentDelivery, MAX_COMMENT_SEND_ATTEMPTS } from "./comment-delivery";
import { createHash } from "node:crypto";
import { UnrecoverableError, Worker, type Job } from "bullmq";
import {
  getDMQueue,
  getRedisConnection,
  MESSAGE_JOB_NAME,
  POSTBACK_JOB_NAME,
  FOLLOWUP_JOB_NAME,
  type DmQueueJob,
  type ProcessCommentJob,
  type ProcessMessageJob,
  type ProcessPostbackJob,
  type ProcessFollowUpJob,
} from "./client";
import { prisma } from "@/lib/db/client";
import {
  MetaApiError,
  RateLimitError,
  TokenExpiredError,
  getUserFollowStatus,
  sendCommentReply,
  sendDirectMessage,
  sendDirectMessageWithButton,
  sendDirectMessageWithLinkButton,
  sendPrivateReply,
  sendPrivateReplyWithButton,
  sendPrivateReplyWithLinkButton,
  createInstagramContext,
  hasInstagramCredentials,
  type InstagramContext,
} from "@/lib/instagram/provider";
import { matchKeywords } from "@/lib/utils/keyword-matcher";
import { reserveDMSlot, releaseDMSlot } from "@/lib/utils/rate-limiter";
import {
  releaseWorkspaceDMReservation,
  reserveWorkspaceDMSend,
} from "@/lib/billing/usage";
import { recordWorkerAlert } from "@/lib/ops/worker-health";
import {
  buildTrackedUrl,
  renderMessageWithTracking,
  renderMessageWithoutLink,
} from "@/lib/tracking/message";
import { TRACKED_LINK_ORDER } from "@/lib/tracking/link-order";
import { ZernioApiError } from "@/lib/zernio/client";

const BACKOFF_DELAYS = [5 * 60 * 1000, 15 * 60 * 1000, 45 * 60 * 1000];

// `is_user_follow_business` lags a brand-new follow (measured: still false at 17 s, true by ~68 s),
// so a false on tap is re-checked after each delay instead of rejecting someone who just followed.
const FOLLOW_RECHECK_DELAYS_MS = (
  process.env.FOLLOW_RECHECK_DELAYS_MS ?? "20000,40000"
)
  .split(",")
  .map(Number)
  .filter((ms) => ms > 0);
const FOLLOW_RECHECK_TOTAL_MS = FOLLOW_RECHECK_DELAYS_MS.reduce(
  (total, ms) => total + ms,
  0
);

const DEFAULT_FOLLOW_PROMPT =
  "quick favor before i send your link. i don't make any money from this, it's free. if you want to support me, just don't unfollow after, and star the repo on github if it helps you. tap the button once you're following and i'll send it over";

function formatError(error: unknown): string {
  if (error instanceof MetaApiError) {
    return `${error.name} ${error.code}: ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
}

// Conversation-level refusals: a text retry fails too and overwrites the real error with a
// misleading one (the first attempt already used the comment's single private reply).
const NON_TEMPLATE_REJECTIONS = [
  /outside of allowed window/i,
  /invalid for a private reply/i,
  /requested user cannot be found/i,
];

function isTemplateRejection(error: unknown): boolean {
  if (
    error instanceof TokenExpiredError ||
    error instanceof RateLimitError ||
    error instanceof ZernioApiError
  ) {
    return false;
  }
  // Falling back is another send: allow it only for a proven template error.
  return error instanceof MetaApiError && error.code === 100 &&
    /template|button/i.test(error.message) &&
    !NON_TEMPLATE_REJECTIONS.some((pattern) => pattern.test(error.message));
}

type WorkerTrackedLink = {
  slug: string;
  label: string | null;
  destinationUrl: string;
};

// Meta allows at most 3 buttons per template.
function buildLinkButtons(
  trackedLinks: WorkerTrackedLink[],
  primaryLabel: string | null
): { title: string; url: string }[] {
  return trackedLinks.slice(0, 3).map((link, index) => ({
    url: buildTrackedUrl(link.slug),
    title: (index === 0 && primaryLabel) || link.label || "Open link",
  }));
}

// Used when Meta rejects the button template: extra links go on their own lines so none is lost.
function buildInlineLinkFallback(
  message: string,
  commenterName: string | null | undefined,
  trackedLinks: WorkerTrackedLink[],
  bodyText: string
): string {
  const base =
    renderMessageWithTracking({ message, commenterName, trackedLinks }) ||
    bodyText;
  const extraUrls = trackedLinks
    .slice(1)
    .map((link) => buildTrackedUrl(link.slug));
  return extraUrls.length > 0 ? `${base}\n${extraUrls.join("\n")}` : base;
}

type RevealAutomation = {
  dmMessage: string;
  linkButtonLabel: string | null;
  trackedLinks: WorkerTrackedLink[];
  instagramAccount: { instagramId: string };
};

// Postback and DM-trigger paths already have an open conversation, so no private reply.
async function sendRevealDirectMessage({
  accessToken,
  automation,
  userId,
  commenterName,
  context,
}: {
  accessToken: InstagramContext;
  automation: RevealAutomation;
  userId: string;
  commenterName: string | null;
  context: string;
}): Promise<void> {
  if (automation.trackedLinks.length === 0) {
    await sendDirectMessage({
      context: accessToken,
      instagramAccountId: automation.instagramAccount.instagramId,
      userId,
      message: renderMessageWithTracking({
        message: automation.dmMessage,
        commenterName,
        trackedLinks: automation.trackedLinks,
      }),
    });
    return;
  }

  const bodyText =
    renderMessageWithoutLink({
      message: automation.dmMessage,
      commenterName,
    }) || "Here's your link:";
  const buttons = buildLinkButtons(
    automation.trackedLinks,
    automation.linkButtonLabel
  );

  try {
    await sendDirectMessageWithLinkButton({
      context: accessToken,
      instagramAccountId: automation.instagramAccount.instagramId,
      userId,
      text: bodyText,
      buttons,
    });
  } catch (buttonError) {
    if (!isTemplateRejection(buttonError)) throw buttonError;

    console.log(
      `[DM Worker] Button template rejected in ${context}, falling back to inline link:`,
      formatError(buttonError)
    );
    try {
      await sendDirectMessage({
        context: accessToken,
        instagramAccountId: automation.instagramAccount.instagramId,
        userId,
        message: buildInlineLinkFallback(
          automation.dmMessage,
          commenterName,
          automation.trackedLinks,
          bodyText
        ),
      });
    } catch (fallbackError) {
      throw classifySendError(fallbackError);
    }
  }
}

// Deterministic job id dedupes repeat taps to one follow-up per user.
async function scheduleFollowUp(
  automation: {
    id: string;
    instagramAccountId: string;
    instagramAccount: { instagramId: string };
    followUpEnabled: boolean;
    followUpMessage: string | null;
    followUpDelayMinutes: number | null;
  },
  userId: string,
  commenterName: string | null,
): Promise<void> {
  if (!automation.followUpEnabled || !automation.followUpMessage?.trim()) return;
  await getDMQueue().add(
    FOLLOWUP_JOB_NAME,
    {
      instagramAccountId: automation.instagramAccount.instagramId,
      accountConnectionId: automation.instagramAccountId,
      userId,
      automationId: automation.id,
      commenterName,
    },
    {
      delay: Math.max(0, automation.followUpDelayMinutes ?? 0) * 60_000,
      jobId: `followup_${automation.id}_${userId}`,
    },
  );
}

// Returns the context, or the DmLog error message when none can be built.
async function loadContext(
  account: Parameters<typeof createInstagramContext>[0],
  operationId: string,
): Promise<InstagramContext | string> {
  if (!hasInstagramCredentials(account)) return "No Instagram access token available";
  try {
    return await createInstagramContext(account, operationId);
  } catch {
    return "Failed to decrypt Instagram access token";
  }
}

function logWhere(automationId: string, commentId: string) {
  return { automationId_commentId: { automationId, commentId } };
}

function connectionScope(data: DmQueueJob) {
  return data.accountConnectionId ? { instagramAccountId: data.accountConnectionId } : {};
}

async function processComment(job: Job<ProcessCommentJob>): Promise<void> {
  const {
    instagramAccountId,
    commentId,
    commentText,
    commenterId,
    commenterName,
    mediaId,
    originalMediaId,
  } = job.data;
  const requeueAttempt = job.data.requeueAttempt ?? 0;

  const automations = await prisma.automation.findMany({
    where: {
      ...connectionScope(job.data),
      // Ad comments carry the ad's media id but campaigns bind to the source post, so match both.
      OR: [
        { postId: mediaId },
        ...(originalMediaId ? [{ postId: originalMediaId }] : []),
        { matchAnyPost: true },
      ],
      isActive: true,
      instagramAccount: {
        instagramId: instagramAccountId,
      },
    },
    include: {
      instagramAccount: true,
      workspace: true,
      trackedLinks: {
        select: {
          slug: true,
          label: true,
          destinationUrl: true,
        },
        orderBy: TRACKED_LINK_ORDER,
      },
    },
    orderBy: { createdAt: "asc" },
  });

  for (const automation of automations) {
    const matchResult = automation.matchAnyWord
      ? { matched: true, matchedKeyword: null }
      : matchKeywords(
          commentText,
          automation.keywords,
          automation.wholeWordMatch
        );

    if (!matchResult.matched) {
      continue;
    }

    const existingLog = await prisma.dmLog.findUnique({
      where: logWhere(automation.id, commentId),
    });

    if (existingLog?.status === "FAILED" && hasLegacyUnconfirmedDelivery(existingLog.errorMessage)) {
      await prisma.dmLog.update({
        where: logWhere(automation.id, commentId),
        data: { dmDeliveryUnconfirmed: true },
      });
      existingLog.dmDeliveryUnconfirmed = true;
    }

    const alreadyDmd = existingLog?.status === "SENT";
    const alreadyPublicReplied = Boolean(existingLog?.publicReplySentAt);
    const needsDm = !alreadyDmd && !existingLog?.dmDeliveryUnconfirmed &&
      (existingLog?.attempts ?? 0) < MAX_COMMENT_SEND_ATTEMPTS;

    if (existingLog?.status === "SKIPPED_PLAN_LIMIT") continue;
    // A sent DM with an unposted public reply must still come back so the reply can be retried.
    if (
      !needsDm &&
      (alreadyPublicReplied || existingLog?.publicReplyDeliveryUnconfirmed || !automation.publicReplyEnabled)
    ) {
      continue;
    }

    const accessToken = await loadContext(automation.instagramAccount, `${job.id}:${automation.id}`);
    if (typeof accessToken === "string") {
      await prisma.dmLog.upsert({
        where: logWhere(automation.id, commentId),
        create: {
          workspaceId: automation.workspaceId,
          automationId: automation.id,
          instagramAccountId: automation.instagramAccountId,
          commenterId,
          commenterName,
          commentText,
          commentId,
          matchedKeyword: matchResult.matchedKeyword,
          status: "FAILED",
          errorMessage: accessToken,
        },
        update: { status: "FAILED", errorMessage: accessToken },
      });
      continue;
    }

    await prisma.dmLog.upsert({
      where: logWhere(automation.id, commentId),
      create: {
        workspaceId: automation.workspaceId,
        automationId: automation.id,
        instagramAccountId: automation.instagramAccountId,
        commenterId, commenterName, commentText, commentId,
        matchedKeyword: matchResult.matchedKeyword,
        status: "PENDING",
      },
      update: {},
    });

    // Public reply goes first so a DM failure (e.g. restricted non-follower) never suppresses it.
    const replyPool =
      automation.publicReplyMessages.length > 0
        ? automation.publicReplyMessages
        : automation.publicReplyMessage
          ? [automation.publicReplyMessage]
          : [];
    if (
      automation.publicReplyEnabled &&
      replyPool.length > 0 &&
      !existingLog?.publicReplySentAt &&
      !existingLog?.publicReplyDeliveryUnconfirmed &&
      await claimCommentDelivery(automation.id, commentId, "public")
    ) {
      try {
        const chosen = replyPool[Math.floor(Math.random() * replyPool.length)];
        const publicReply = renderMessageWithTracking({
          message: chosen,
          commenterName,
          trackedLinks: automation.trackedLinks,
        });
        await sendCommentReply({
          context: accessToken,
          commentId,
          message: publicReply,
          postId: mediaId,
        });
        await prisma.dmLog.update({
          where: logWhere(automation.id, commentId),
          data: { publicReplySentAt: new Date(), publicReplyError: null, publicReplyDeliveryUnconfirmed: false },
        });
      } catch (error) {
        console.error(
          "[DM Worker] Public comment reply failed:",
          formatError(error)
        );
        await prisma.dmLog
          .update({
            where: logWhere(automation.id, commentId),
            data: { publicReplyError: formatError(classifySendError(error)), publicReplyDeliveryUnconfirmed: !isConfirmedSendRejection(error) },
          })
          .catch(() => {});
      }
    }

    if (!needsDm) continue;

    // Meta allows ONE private reply per comment across all campaigns; later matches would fail
    // with "invalid for a private reply", so skip them. Public replies still go out per campaign.
    const privateReplyUsedBy = await prisma.dmLog.findFirst({
      where: {
        commentId,
        status: "SENT",
        automationId: { not: automation.id },
      },
      select: { automation: { select: { name: true } } },
    });
    if (privateReplyUsedBy) {
      await prisma.dmLog.update({
        where: logWhere(automation.id, commentId),
        data: {
          status: "SKIPPED_DEDUP",
          matchedKeyword: matchResult.matchedKeyword,
          errorMessage: `Another campaign (${privateReplyUsedBy.automation?.name ?? "unknown"}) already sent the one private reply Instagram allows for this comment`,
        },
      });
      continue;
    }

    const usage = await reserveWorkspaceDMSend(automation.workspaceId);
    if (!usage.allowed) {
      await prisma.dmLog.update({
        where: logWhere(automation.id, commentId),
        data: {
          status: "SKIPPED_PLAN_LIMIT",
          matchedKeyword: matchResult.matchedKeyword,
          errorMessage: `Monthly DM limit reached (${usage.limit})`,
        },
      });
      continue;
    }

    let rateLimit;
    try {
      rateLimit = await reserveDMSlot(instagramAccountId, requeueAttempt);
    } catch (error) {
      await releaseWorkspaceDMReservation(
        automation.workspaceId,
        usage.periodStart
      );
      await prisma.dmLog.update({
        where: logWhere(automation.id, commentId),
        data: {
          status: "FAILED",
          errorMessage: formatError(error),
        },
      });
      throw error;
    }

    if (!rateLimit.allowed) {
      await releaseWorkspaceDMReservation(
        automation.workspaceId,
        usage.periodStart
      );

      if (rateLimit.shouldSkip) {
        await prisma.dmLog.update({
          where: logWhere(automation.id, commentId),
          data: {
            status: "SKIPPED_RATE_LIMIT",
            matchedKeyword: matchResult.matchedKeyword,
            errorMessage: "Hourly Instagram DM rate limit reached",
          },
        });
        continue;
      }

      if (rateLimit.shouldRequeue) {
        await prisma.dmLog.update({
          where: logWhere(automation.id, commentId),
          data: {
            status: "PENDING",
            matchedKeyword: matchResult.matchedKeyword,
            errorMessage: "Hourly rate limit hit; retry scheduled",
          },
        });

        await getDMQueue().add(
          "process-comment",
          {
            ...job.data,
            requeueAttempt: requeueAttempt + 1,
          },
          {
            delay: rateLimit.requeueDelayMs,
            jobId: `comment_${instagramAccountId}_${commentId}_retry_${requeueAttempt + 1}`,
          }
        );
        continue;
      }
    }

    const useOpeningDm =
      automation.openingDmEnabled &&
      Boolean(automation.openingDmMessage) &&
      Boolean(automation.openingDmButtonLabel);

    // With an opening DM, its button routes into the follow check (opening DM, gate, link).
    // Otherwise check now: confirmed followers get the link, everyone else the prompt.
    let sendFollowPrompt = false;
    if (automation.requireFollow && !useOpeningDm) {
      const alreadyFollows = await getUserFollowStatus({
        context: accessToken,
        recipientId: commenterId,
      });
      sendFollowPrompt =
        accessToken.provider === "ZERNIO"
          ? alreadyFollows === false
          : alreadyFollows !== true;
    }

    let claimed;
    try {
      claimed = await claimCommentDelivery(automation.id, commentId, "dm");
    } catch (error) {
      if (rateLimit?.reserved) await releaseDMSlot(instagramAccountId);
      await releaseWorkspaceDMReservation(automation.workspaceId, usage.periodStart);
      throw error;
    }
    if (!claimed) {
      if (rateLimit?.reserved) await releaseDMSlot(instagramAccountId);
      await releaseWorkspaceDMReservation(automation.workspaceId, usage.periodStart);
      continue;
    }
    let delivered = false;
    try {
      if (useOpeningDm) {
        const openingText = renderMessageWithTracking({
          message: automation.openingDmMessage as string,
          commenterName,
          trackedLinks: [],
        });
        await sendPrivateReplyWithButton({
          context: accessToken,
          instagramAccountId: automation.instagramAccount.instagramId,
          commentId,
          text: openingText,
          buttonTitle: automation.openingDmButtonLabel as string,
          // ":open" distinguishes this tap from the follow prompt's button, which shares the prefix.
          payload: `${automation.requireFollow ? "followcheck" : "reveal"}:${automation.id}:open`,
          postId: mediaId,
        });
      } else if (sendFollowPrompt) {
        const promptText = renderMessageWithoutLink({
          message: automation.followPromptMessage || DEFAULT_FOLLOW_PROMPT,
          commenterName,
        });
        await sendPrivateReplyWithButton({
          context: accessToken,
          instagramAccountId: automation.instagramAccount.instagramId,
          commentId,
          text: promptText,
          buttonTitle: automation.followPromptButtonLabel || "i'm following",
          payload: `followcheck:${automation.id}`,
          postId: mediaId,
        });
      } else if (automation.trackedLinks.length > 0) {
        const bodyText =
          renderMessageWithoutLink({
            message: automation.dmMessage,
            commenterName,
          }) || "Here's your link:";
        const buttons = buildLinkButtons(
          automation.trackedLinks,
          automation.linkButtonLabel
        );

        try {
          await sendPrivateReplyWithLinkButton({
            context: accessToken,
            instagramAccountId: automation.instagramAccount.instagramId,
            commentId,
            text: bodyText,
            buttons,
            postId: mediaId,
          });
        } catch (buttonError) {
          if (!isTemplateRejection(buttonError)) throw buttonError;

          console.log(
            "[DM Worker] Button template rejected, falling back to inline link:",
            formatError(buttonError)
          );
          const fallbackMessage = buildInlineLinkFallback(
            automation.dmMessage,
            commenterName,
            automation.trackedLinks,
            bodyText
          );
          try {
            await sendPrivateReply({
              context: accessToken,
              instagramAccountId: automation.instagramAccount.instagramId,
              commentId,
              message: fallbackMessage,
              postId: mediaId,
            });
          } catch (fallbackError) {
            throw classifySendError(fallbackError);
          }
        }
      } else {
        const dmMessage = renderMessageWithTracking({
          message: automation.dmMessage,
          commenterName,
          trackedLinks: automation.trackedLinks,
        });
        await sendPrivateReply({
          context: accessToken,
          instagramAccountId: automation.instagramAccount.instagramId,
          commentId,
          message: dmMessage,
          postId: mediaId,
        });
      }

      delivered = true;
      await prisma.dmLog.update({
        where: logWhere(automation.id, commentId),
        data: {
          status: "SENT",
          dmSentAt: new Date(),
          dmDeliveryUnconfirmed: false,
          errorMessage: null,
        },
      });
    } catch (error) {
      const sendError = classifySendError(error);
      // Keep reservations when the provider may have delivered anyway.
      if (isConfirmedSendRejection(sendError)) {
        if (rateLimit?.reserved) await releaseDMSlot(instagramAccountId);
        await releaseWorkspaceDMReservation(automation.workspaceId, usage.periodStart);
      }
      await prisma.dmLog.update({
        where: logWhere(automation.id, commentId),
        data: {
          status: delivered ? "SENT" : "FAILED",
          ...(delivered ? { dmSentAt: new Date() } : {}),
          errorMessage: formatError(sendError),
          dmDeliveryUnconfirmed: isDeliveryUnconfirmed(sendError),
        },
      });
      throw sendError;
    }
  }
}

async function sendPostbackOnce({
  operationId,
  send,
}: {
  operationId: string;
  send: () => Promise<unknown>;
}): Promise<boolean> {
  try {
    await prisma.postbackDelivery.create({ data: { id: operationId } });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    )
      return false;
    throw error;
  }
  try {
    await send();
    return true;
  } catch (error) {
    // The durable claim survives eviction, redelivery and crashes; only confirmed rejections may retry.
    if (isConfirmedSendRejection(error)) {
      await prisma.postbackDelivery.delete({ where: { id: operationId } });
      throw error;
    }
    throw classifySendError(error);
  }
}

// Opt-in, best-effort "checking your follow" reply so the chat isn't silent during a re-check.
async function sendFollowRecheckAck({
  context,
  instagramAccountId,
  automationId,
  userId,
  operationId,
}: {
  context: InstagramContext;
  instagramAccountId: string;
  automationId: string;
  userId: string;
  operationId: string | null;
}): Promise<void> {
  const message = process.env.FOLLOW_RECHECK_ACK_MESSAGE?.trim();
  if (!message) return;
  try {
    // One ack per re-check cycle, matching the bucketed re-check job id.
    const first = await getRedisConnection().set(
      `follow_recheck_ack:${automationId}:${userId}`,
      "1",
      "PX",
      FOLLOW_RECHECK_TOTAL_MS,
      "NX"
    );
    if (first !== "OK") return;
    const send = () =>
      sendDirectMessage({ context, instagramAccountId, userId, message });
    // Own id: the tap's id is claimed later by the re-check's link or prompt.
    if (operationId) {
      await sendPostbackOnce({ operationId: `${operationId}:ack`, send });
    } else {
      await send();
    }
  } catch (error) {
    console.log(
      "[DM Worker] Failed to send follow re-check acknowledgement:",
      formatError(error),
    );
  }
}

async function processPostback(job: Job<ProcessPostbackJob>): Promise<void> {
  const { instagramAccountId, userId, payload, fallback } = job.data;

  const isFollowCheck = payload.startsWith("followcheck:");
  if (!isFollowCheck && !payload.startsWith("reveal:")) return;
  // Automation ids are cuids and contain no colon.
  const [automationId, marker] = payload
    .slice(isFollowCheck ? "followcheck:".length : "reveal:".length)
    .split(":");
  const fromOpeningDm = marker === "open";

  const automation = await prisma.automation.findFirst({
    where: { id: automationId, isActive: true, ...connectionScope(job.data) },
    include: {
      instagramAccount: true,
      workspace: true,
      trackedLinks: {
        select: { slug: true, label: true, destinationUrl: true },
        orderBy: TRACKED_LINK_ORDER,
      },
    },
  });

  if (
    !automation ||
    automation.instagramAccount.instagramId !== instagramAccountId ||
    !hasInstagramCredentials(automation.instagramAccount)
  ) {
    return;
  }

  // Not a send dedup: every tap re-sends the reveal. Keys the log row and the read-fallback check.
  const dedupeId = `reveal:${userId}`;

  if (fallback) {
    const existingReveal = await prisma.dmLog.findUnique({
      where: logWhere(automation.id, dedupeId),
    });
    if (
      existingReveal?.status === "SENT" ||
      existingReveal?.dmDeliveryUnconfirmed
    )
      return;
  }

  const openingLog = await prisma.dmLog.findFirst({
    where: { automationId: automation.id, commenterId: userId },
    select: { commenterName: true },
  });
  const commenterName = openingLog?.commenterName ?? null;

  const accessToken = await loadContext(automation.instagramAccount, `${job.id}:${automation.id}`);
  if (typeof accessToken === "string") return;

  const operationId = createHash("sha256")
    .update(JSON.stringify([
      automation.instagramAccountId,
      automation.id,
      userId,
      job.data.mid ?? job.id ?? payload,
    ]))
    .digest("hex");

  // A tap fails open on null so a real follower is never trapped; a read fallback must not, or
  // reading and waiting would bypass the gate.
  if ((isFollowCheck || fallback) && automation.requireFollow) {
    const follows = await getUserFollowStatus({
      context: accessToken,
      recipientId: userId,
    });
    // Before any tap Instagram answers "User consent is required" (null), so require true here.
    if (fallback && follows !== true) return;
    if (follows === false) {
      // An opening-DM tap is not a claim to follow, so it gets the prompt at once; only the
      // prompt's own button earns re-checks.
      if (!fromOpeningDm) {
        // Job id is bucketed by time: BullMQ silently drops adds whose id is still retained
        // (removeOnComplete), so a fixed id allowed only one re-check per user ever.
        const rechecksDone =
          job.data.followRecheckAttempt ?? (job.data.followRecheck ? 1 : 0);
        if (rechecksDone < FOLLOW_RECHECK_DELAYS_MS.length) {
          const delay = FOLLOW_RECHECK_DELAYS_MS[rechecksDone];
          const window = Math.floor(Date.now() / delay);
          await getDMQueue().add(
            POSTBACK_JOB_NAME,
            {
              ...job.data,
              followRecheck: true,
              followRecheckAttempt: rechecksDone + 1,
            },
            {
              delay,
              jobId: `postback_recheck_${automation.id}_${userId}_${rechecksDone + 1}_${window}`,
            }
          );
          if (rechecksDone === 0) {
            await sendFollowRecheckAck({
              context: accessToken,
              instagramAccountId: automation.instagramAccount.instagramId,
              automationId: automation.id,
              userId,
              operationId,
            });
          }
          return;
        }

        // Recorded so the gate's rejection rate can be measured.
        await prisma.operationalEvent
          .create({
            data: {
              workspaceId: automation.workspaceId,
              source: "WORKER",
              level: "INFO",
              message: "Follow gate rejected a button tap",
              payload: {
                automationId: automation.id,
                automationName: automation.name,
                userId,
                commenterName,
              },
            },
          })
          .catch(() => {});
      }

      const promptText = renderMessageWithoutLink({
        message: automation.followPromptMessage || DEFAULT_FOLLOW_PROMPT,
        commenterName,
      });
      try {
        await sendPostbackOnce({
          operationId,
          send: () =>
            sendDirectMessageWithButton({
              context: accessToken,
              instagramAccountId: automation.instagramAccount.instagramId,
              userId,
              text: promptText,
              buttonTitle:
                automation.followPromptButtonLabel || "i'm following",
              payload: `followcheck:${automation.id}`,
            }),
        });
      } catch (error) {
        console.log(
          "[DM Worker] Failed to re-send follow prompt:",
          formatError(error),
        );
      }
      return;
    }
  }

  const usage = await reserveWorkspaceDMSend(automation.workspaceId);
  if (!usage.allowed) {
    await prisma.dmLog.upsert({
      where: logWhere(automation.id, dedupeId),
      create: {
        workspaceId: automation.workspaceId,
        automationId: automation.id,
        instagramAccountId: automation.instagramAccountId,
        commenterId: userId,
        commenterName,
        commentText: "(button tap)",
        commentId: dedupeId,
        status: "SKIPPED_PLAN_LIMIT",
        errorMessage: `Monthly DM limit reached (${usage.limit})`,
      },
      update: { status: "SKIPPED_PLAN_LIMIT" },
    });
    return;
  }

  try {
    const delivered = await sendPostbackOnce({
      operationId,
      send: () =>
        sendRevealDirectMessage({
          accessToken,
          automation,
          userId,
          commenterName,
          context: "postback",
        }),
    });
    if (!delivered) {
      await releaseWorkspaceDMReservation(
        automation.workspaceId,
        usage.periodStart,
      );
      return;
    }
    await scheduleFollowUp(automation, userId, commenterName);
    await prisma.dmLog.upsert({
      where: logWhere(automation.id, dedupeId),
      create: {
        workspaceId: automation.workspaceId,
        automationId: automation.id,
        instagramAccountId: automation.instagramAccountId,
        commenterId: userId,
        commenterName,
        commentText: "(button tap)",
        commentId: dedupeId,
        status: "SENT",
        dmSentAt: new Date(),
      },
      update: { status: "SENT", dmSentAt: new Date(), errorMessage: null },
    });
  } catch (originalError) {
    const error = classifySendError(originalError);
    if (isConfirmedSendRejection(error)) await releaseWorkspaceDMReservation(
      automation.workspaceId,
      usage.periodStart,
    );

    // A read fallback usually hits a closed 24h window (user never messaged us). Expected, so
    // don't log FAILED or retry; it only delivers when the user typed a reply instead of tapping.
    if (fallback && !isDeliveryUnconfirmed(error)) {
      console.log(
        "[DM Worker] Read fallback not delivered (messaging window closed):",
        formatError(error),
      );
      return;
    }

    await prisma.dmLog.upsert({
      where: logWhere(automation.id, dedupeId),
      create: {
        workspaceId: automation.workspaceId,
        automationId: automation.id,
        instagramAccountId: automation.instagramAccountId,
        commenterId: userId,
        commenterName,
        commentText: "(button tap)",
        commentId: dedupeId,
        status: "FAILED",
        errorMessage: formatError(error),
        dmDeliveryUnconfirmed: isDeliveryUnconfirmed(error),
      },
      update: {
        status: "FAILED",
        errorMessage: formatError(error),
        dmDeliveryUnconfirmed: isDeliveryUnconfirmed(error),
      },
    });
    throw error;
  }
}

// Best-effort: a long delay may outlive the 24h window, so failures are logged, not retried.
async function processFollowUp(job: Job<ProcessFollowUpJob>): Promise<void> {
  const { instagramAccountId, userId, automationId, commenterName } = job.data;

  const automation = await prisma.automation.findFirst({
    where: { id: automationId, isActive: true, ...connectionScope(job.data) },
    include: { instagramAccount: true },
  });

  if (
    !automation ||
    !automation.followUpEnabled ||
    !automation.followUpMessage?.trim() ||
    automation.instagramAccount.instagramId !== instagramAccountId
  ) {
    return;
  }

  const accessToken = await loadContext(automation.instagramAccount, `${job.id}:${automation.id}`);
  if (typeof accessToken === "string") return;

  try {
    await sendDirectMessage({
      context: accessToken,
      instagramAccountId: automation.instagramAccount.instagramId,
      userId,
      message: renderMessageWithoutLink({
        message: automation.followUpMessage,
        commenterName: commenterName ?? null,
      }),
    });
  } catch (error) {
    console.log(
      "[DM Worker] Failed to send follow-up message:",
      formatError(error)
    );
  }
}

// Conversation is already open, so no opening DM; dedup is per inbound message id.
async function processMessage(job: Job<ProcessMessageJob>): Promise<void> {
  const { instagramAccountId, messageId, messageText, senderId } = job.data;

  const automations = await prisma.automation.findMany({
    where: {
      ...connectionScope(job.data),
      dmTriggerEnabled: true,
      isActive: true,
      instagramAccount: { instagramId: instagramAccountId },
    },
    include: {
      instagramAccount: true,
      workspace: true,
      trackedLinks: {
        select: { slug: true, label: true, destinationUrl: true },
        orderBy: TRACKED_LINK_ORDER,
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const dedupeId = `dm:${messageId}`;

  for (const automation of automations) {
    const matchResult = automation.matchAnyWord
      ? { matched: true, matchedKeyword: null }
      : matchKeywords(
          messageText,
          automation.keywords,
          automation.wholeWordMatch
        );

    if (!matchResult.matched) continue;

    const existingLog = await prisma.dmLog.findUnique({
      where: logWhere(automation.id, dedupeId),
    });

    if (
      existingLog?.status === "SENT" ||
      existingLog?.status === "SKIPPED_PLAN_LIMIT" ||
      existingLog?.dmDeliveryUnconfirmed
    ) {
      continue;
    }

    const logBase = {
      workspaceId: automation.workspaceId,
      automationId: automation.id,
      instagramAccountId: automation.instagramAccountId,
      commenterId: senderId,
      commentText: messageText,
      commentId: dedupeId,
      matchedKeyword: matchResult.matchedKeyword,
    };

    const accessToken = await loadContext(automation.instagramAccount, `${job.id}:${automation.id}`);
    if (typeof accessToken === "string") {
      await prisma.dmLog.upsert({
        where: logWhere(automation.id, dedupeId),
        create: { ...logBase, status: "FAILED", errorMessage: accessToken },
        update: { status: "FAILED", errorMessage: accessToken },
      });
      continue;
    }

    // The messages webhook carries only the IGSID, so reuse an earlier name for {username}.
    const priorLog = await prisma.dmLog.findFirst({
      where: { automationId: automation.id, commenterId: senderId },
      select: { commenterName: true },
    });
    const commenterName = priorLog?.commenterName ?? null;

    // First contact, so fail closed on null like processComment; fail-open is only safe after a tap.
    let sendFollowPrompt = false;
    if (automation.requireFollow) {
      const follows = await getUserFollowStatus({
        context: accessToken,
        recipientId: senderId,
      });
      sendFollowPrompt =
        accessToken.provider === "ZERNIO"
          ? follows === false
          : follows !== true;
    }

    const usage = await reserveWorkspaceDMSend(automation.workspaceId);
    if (!usage.allowed) {
      await prisma.dmLog.upsert({
        where: logWhere(automation.id, dedupeId),
        create: {
          ...logBase,
          status: "SKIPPED_PLAN_LIMIT",
          errorMessage: `Monthly DM limit reached (${usage.limit})`,
        },
        update: {
          status: "SKIPPED_PLAN_LIMIT",
          errorMessage: `Monthly DM limit reached (${usage.limit})`,
        },
      });
      continue;
    }

    try {
      if (sendFollowPrompt) {
        const promptText = renderMessageWithoutLink({
          message:
            automation.followPromptMessage ||
            "Almost there! Follow me and tap the button below to grab your link 💛",
          commenterName,
        });
        await sendDirectMessageWithButton({
          context: accessToken,
          instagramAccountId: automation.instagramAccount.instagramId,
          userId: senderId,
          text: promptText,
          buttonTitle: automation.followPromptButtonLabel || "I'm following ✅",
          payload: `followcheck:${automation.id}`,
        });
      } else {
        await sendRevealDirectMessage({
          accessToken,
          automation,
          userId: senderId,
          commenterName,
          context: "message trigger",
        });
        await scheduleFollowUp(automation, senderId, commenterName);
      }

      await prisma.dmLog.upsert({
        where: logWhere(automation.id, dedupeId),
        create: {
          ...logBase,
          commenterName,
          status: "SENT",
          dmSentAt: new Date(),
        },
        update: {
          status: "SENT",
          dmSentAt: new Date(),
          errorMessage: null,
        },
      });
    } catch (error) {
      await releaseWorkspaceDMReservation(
        automation.workspaceId,
        usage.periodStart
      );
      await prisma.dmLog.upsert({
        where: logWhere(automation.id, dedupeId),
        create: {
          ...logBase,
          commenterName,
          status: "FAILED",
          attempts: job.attemptsMade + 1,
          errorMessage: formatError(error),
          dmDeliveryUnconfirmed: isDeliveryUnconfirmed(error),
        },
        update: {
          status: "FAILED",
          attempts: job.attemptsMade + 1,
          errorMessage: formatError(error),
          dmDeliveryUnconfirmed: isDeliveryUnconfirmed(error),
        },
      });
      throw error;
    }
  }
}

async function processJob(job: Job<DmQueueJob>): Promise<void> {
  try {
    if (job.name === POSTBACK_JOB_NAME) await processPostback(job as Job<ProcessPostbackJob>);
    else if (job.name === FOLLOWUP_JOB_NAME) await processFollowUp(job as Job<ProcessFollowUpJob>);
    else if (job.name === MESSAGE_JOB_NAME) await processMessage(job as Job<ProcessMessageJob>);
    else await processComment(job as Job<ProcessCommentJob>);
  } catch (error) {
    // Retrying a possibly-delivered send would duplicate the DM.
    if (isDeliveryUnconfirmed(error))
      throw new UnrecoverableError(formatError(error));
    throw error;
  }
}

async function recordWorkerFailure(
  job: Job<DmQueueJob> | undefined,
  error: Error
) {
  try {
    const instagramAccountId = job?.data.instagramAccountId;
    const commentId =
      job && "commentId" in job.data ? job.data.commentId : null;
    const account = instagramAccountId
      ? await prisma.instagramAccount.findUnique({
          where: { instagramId: instagramAccountId },
          select: { workspaceId: true },
        })
      : null;

    await prisma.operationalEvent.create({
      data: {
        workspaceId: account?.workspaceId ?? null,
        source: "WORKER",
        level: "ERROR",
        message: `DM worker job ${job?.id ?? "unknown"} failed: ${error.message}`,
        payload: {
          jobId: job?.id ?? null,
          attemptsMade: job?.attemptsMade ?? null,
          instagramAccountId: instagramAccountId ?? null,
          commentId,
        },
      },
    });

    await recordWorkerAlert({
      level: "error",
      message: error.message,
      jobId: job?.id,
      instagramAccountId,
      commentId: commentId ?? undefined,
    });
  } catch (recordError) {
    console.error(
      "[DM Worker] Failed to record worker failure:",
      formatError(recordError)
    );
  }
}

export function createDMWorker(): Worker<DmQueueJob> {
  const worker = new Worker<DmQueueJob>("dm-processing", processJob, {
    connection: getRedisConnection(),
    concurrency: 5,
    settings: {
      backoffStrategy: (attemptsMade: number) =>
        BACKOFF_DELAYS[Math.min(attemptsMade - 1, BACKOFF_DELAYS.length - 1)],
    },
  });

  worker.on("completed", (job) => {
    console.log(`[DM Worker] Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(
      `[DM Worker] Job ${job?.id} failed (attempt ${job?.attemptsMade}):`,
      err.message
    );
    void recordWorkerFailure(job, err);
  });

  worker.on("error", (err) => {
    console.error("[DM Worker] Worker error:", err.message);
    void prisma.operationalEvent
      .create({
        data: {
          source: "WORKER",
          level: "ERROR",
          message: `DM worker process error: ${err.message}`,
          payload: { name: err.name },
        },
      })
      .catch((recordError) => {
        console.error(
          "[DM Worker] Failed to record worker process error:",
          formatError(recordError)
        );
      });
  });

  return worker;
}
