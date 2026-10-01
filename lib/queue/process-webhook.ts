import { prisma } from '@/lib/db/client';
import { getDMQueue, MESSAGE_JOB_NAME, POSTBACK_JOB_NAME } from '@/lib/queue/client';
import { parseCommentEvents, parseMessageEvents, parsePostbackEvents, parseReadEvents } from '@/lib/meta/webhook';
import { Prisma, type InstagramProvider } from '@/app/generated/prisma/client';

const OPENING_DM_READ_FALLBACK_DELAY_MS = 5 * 60 * 1000;
type InstagramPayload = Parameters<typeof parseCommentEvents>[0];

export async function processInstagramWebhook({ payload: incoming, provider, workspaceId }: {
  payload: InstagramPayload; provider: InstagramProvider; workspaceId?: string;
}) {
  if (incoming.object !== 'instagram' || !Array.isArray(incoming.entry)) return;
  const accounts = await prisma.instagramAccount.findMany({
    where: { instagramId: { in: incoming.entry.map(e => e.id) }, provider, ...(workspaceId ? { workspaceId } : {}) },
    select: { id: true, instagramId: true, workspaceId: true },
  });
  const accountMap = new Map(accounts.map(a => [a.instagramId, a]));
  const payload = { ...incoming, entry: incoming.entry.filter(e => accountMap.has(e.id)) };
  if (!payload.entry.length) return;
  const webhookEvent = await prisma.webhookEvent.create({
    data: {
      object: payload.object,
      payload: payload as unknown as Prisma.InputJsonValue,
      ...(workspaceId ? { workspaceId } : {}),
      status: "PENDING",
    },
  });

  try {
    const queue = getDMQueue();

    for (const event of parseCommentEvents(payload)) {
      const account = accountMap.get(event.instagramAccountId);
      if (!account) continue;

      await queue.add(
        "process-comment",
        {
          instagramAccountId: event.instagramAccountId,
          accountConnectionId: account.id,
          commentId: event.commentId,
          commentText: event.commentText,
          commenterId: event.commenterId,
          commenterName: event.commenterName,
          mediaId: event.mediaId,
          originalMediaId: event.originalMediaId,
          source: "WEBHOOK",
        },
        {
          jobId: `comment_${event.instagramAccountId}_${event.commentId}`,
        }
      );
      await prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: { workspaceId: account.workspaceId },
      });
    }

    for (const event of parsePostbackEvents(payload)) {
      await queue.add(
        POSTBACK_JOB_NAME,
        {
          instagramAccountId: event.instagramAccountId,
          accountConnectionId: accountMap.get(event.instagramAccountId)?.id,
          userId: event.userId,
          payload: event.payload,
          mid: event.mid,
        },
        {
          // BullMQ forbids ":" in custom job ids, and payloads look like "reveal:<id>".
          jobId: `postback_${event.instagramAccountId}_${event.userId}_${(
            event.mid ?? event.payload
          ).replace(/:/g, "_")}`,
        }
      );
    }

    for (const event of parseMessageEvents(payload)) {
      const account = accountMap.get(event.instagramAccountId);
      if (!account) continue;

      await queue.add(
        MESSAGE_JOB_NAME,
        {
          instagramAccountId: event.instagramAccountId,
          accountConnectionId: account.id,
          messageId: event.messageId,
          messageText: event.messageText,
          senderId: event.senderId,
        },
        {
          // base64url, not character substitution: mids may contain ":" and substitution could
          // collapse two distinct mids onto one job id, silently dropping a reply.
          jobId: `message_${event.instagramAccountId}_${Buffer.from(
            event.messageId
          ).toString("base64url")}`,
        }
      );
      await prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: { workspaceId: account.workspaceId },
      });
    }

    // Read but never tapped: deliver the reveal after 5 min. The worker no-ops if a tap already did.
    for (const event of parseReadEvents(payload)) {
      const openingLogs = await prisma.dmLog.findMany({
        where: {
          commenterId: event.userId,
          status: "SENT",
          automation: {
            isActive: true,
            openingDmEnabled: true,
            instagramAccount: {
              instagramId: event.instagramAccountId,
            },
          },
        },
        select: { automationId: true },
        distinct: ["automationId"],
      });

      for (const { automationId } of openingLogs) {
        await queue.add(
          POSTBACK_JOB_NAME,
          {
            instagramAccountId: event.instagramAccountId,
            accountConnectionId: accountMap.get(event.instagramAccountId)?.id,
            userId: event.userId,
            payload: `reveal:${automationId}`,
            fallback: true,
          },
          {
            delay: OPENING_DM_READ_FALLBACK_DELAY_MS,
            jobId: `read_fallback_${event.instagramAccountId}_${event.userId}_${automationId}`,
          }
        );
      }
    }

    await prisma.webhookEvent.update({
      where: { id: webhookEvent.id },
      data: { status: "PROCESSED", processedAt: new Date() },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await prisma.webhookEvent.update({
      where: { id: webhookEvent.id },
      data: {
        status: "FAILED",
        errorMessage: message,
        processedAt: new Date(),
      },
    });

    throw error;
  }
}
