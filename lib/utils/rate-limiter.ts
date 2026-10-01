// Meta's documented cap: 750 private replies per hour per account. No headroom,
// so lower it if Meta throttles earlier or other calls share the bucket.
import Redis from "ioredis";

export const RATE_LIMIT_MAX = 750;
const RATE_LIMIT_WINDOW = 3600;
const REQUEUE_DELAY_MS = 30 * 60 * 1000;
const MAX_REQUEUE_ATTEMPTS = 3;

let redis: Redis | null = null;

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL!, {
      maxRetriesPerRequest: null, // required by BullMQ
    });
  }
  return redis;
}

export interface RateLimitResult {
  allowed: boolean;
  currentCount: number;
  remainingDMs: number;
  shouldRequeue: boolean;
  requeueDelayMs: number;
  shouldSkip: boolean;
  reserved: boolean;
}

const RESERVE_DM_SLOT_SCRIPT = `
local current = tonumber(redis.call("GET", KEYS[1]) or "0")
local max = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])

if current >= max then
  return {0, current, 0}
end

local next_count = redis.call("INCR", KEYS[1])
if next_count == 1 then
  redis.call("EXPIRE", KEYS[1], ttl)
end

return {1, next_count, max - next_count}
`;

function toScriptNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number.parseInt(value, 10);
  return 0;
}

function blockedResult(
  count: number,
  requeueAttempt: number
): RateLimitResult {
  const skip = requeueAttempt >= MAX_REQUEUE_ATTEMPTS;
  return {
    allowed: false,
    currentCount: count,
    remainingDMs: 0,
    shouldRequeue: !skip,
    requeueDelayMs: skip ? 0 : REQUEUE_DELAY_MS,
    shouldSkip: skip,
    reserved: false,
  };
}

export async function checkRateLimit(
  instagramAccountId: string,
  requeueAttempt: number = 0
): Promise<RateLimitResult> {
  const client = getRedis();
  const key = `rate:dm:${instagramAccountId}`;

  const currentCount = await client.get(key);
  const count = currentCount ? parseInt(currentCount, 10) : 0;

  if (count >= RATE_LIMIT_MAX) return blockedResult(count, requeueAttempt);

  return {
    allowed: true,
    currentCount: count,
    remainingDMs: RATE_LIMIT_MAX - count,
    shouldRequeue: false,
    requeueDelayMs: 0,
    shouldSkip: false,
    reserved: false,
  };
}

// Atomic, so concurrent jobs cannot all pass the check before any increments.
export async function reserveDMSlot(
  instagramAccountId: string,
  requeueAttempt: number = 0
): Promise<RateLimitResult> {
  const client = getRedis();
  const key = `rate:dm:${instagramAccountId}`;

  const result = await client.eval(
    RESERVE_DM_SLOT_SCRIPT,
    1,
    key,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW
  );
  const values = Array.isArray(result) ? result : [];
  const allowedFlag = toScriptNumber(values[0]);
  const count = toScriptNumber(values[1]);
  const remaining = toScriptNumber(values[2]);

  if (allowedFlag !== 1) {
    return blockedResult(count, requeueAttempt);
  }

  return {
    allowed: true,
    currentCount: count,
    remainingDMs: remaining,
    shouldRequeue: false,
    requeueDelayMs: 0,
    shouldSkip: false,
    reserved: true,
  };
}

// Hand back a slot whose send failed, or retries inflate the counter. DECR keeps
// the TTL; a missing key would go to -1 with no expiry, so clamp to zero.
export async function releaseDMSlot(
  instagramAccountId: string
): Promise<number> {
  const client = getRedis();
  const key = `rate:dm:${instagramAccountId}`;
  const next = await client.decr(key);
  if (next < 0) {
    await client.del(key);
    return 0;
  }
  return next;
}

// Test helper. Prefer reserveDMSlot in workers.
export async function incrementDMCounter(
  instagramAccountId: string
): Promise<number> {
  const result = await reserveDMSlot(instagramAccountId, MAX_REQUEUE_ATTEMPTS);
  return result.currentCount;
}
