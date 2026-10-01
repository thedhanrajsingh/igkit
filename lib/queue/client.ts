import { Queue } from "bullmq";
import Redis from "ioredis";

let connection: Redis | null = null;

export function getRedisConnection(): Redis {
  if (!connection) {
    connection = new Redis(process.env.REDIS_URL!, {
      maxRetriesPerRequest: null, // required by BullMQ
    });
  }
  return connection;
}

export interface ProcessCommentJob {
  accountConnectionId?: string;
  instagramAccountId: string;
  commentId: string;
  commentText: string;
  commenterId: string;
  commenterName?: string;
  mediaId: string;
  // Ad comments: the organic post the ad came from, which campaigns bind to.
  originalMediaId?: string;
  requeueAttempt?: number;
  // Not copied to ProcessedComment or used for reconciliation dedup.
  source?: "WEBHOOK" | "POLLING";
}

export interface ProcessPostbackJob {
  accountConnectionId?: string;
  instagramAccountId: string;
  userId: string;
  payload: string;
  mid?: string;
  fallback?: boolean;
  // Delayed follow re-checks done so far; older jobs carry only followRecheck, meaning one.
  followRecheck?: boolean;
  followRecheckAttempt?: number;
}

export interface ProcessFollowUpJob {
  accountConnectionId?: string;
  instagramAccountId: string;
  userId: string;
  automationId: string;
  commenterName?: string | null;
}

export interface ProcessMessageJob {
  accountConnectionId?: string;
  instagramAccountId: string;
  messageId: string;
  messageText: string;
  senderId: string;
}

export type DmQueueJob =
  | ProcessCommentJob
  | ProcessPostbackJob
  | ProcessFollowUpJob
  | ProcessMessageJob;

export const POSTBACK_JOB_NAME = "process-postback";
export const FOLLOWUP_JOB_NAME = "process-followup";
export const MESSAGE_JOB_NAME = "process-message";

let dmQueue: Queue<DmQueueJob> | null = null;

export function getDMQueue(): Queue<DmQueueJob> {
  if (!dmQueue) {
    dmQueue = new Queue<DmQueueJob>("dm-processing", {
      connection: getRedisConnection(),
      defaultJobOptions: {
        removeOnComplete: { count: 1000 },
        // Job ids are deterministic, so a retained failed job would block the reconciler
        // from ever re-enqueueing that comment. Failure detail survives in DmLog.
        removeOnFail: { age: 300, count: 2000 },
        attempts: 3,
        backoff: { type: "custom" },
      },
    });
  }
  return dmQueue;
}
