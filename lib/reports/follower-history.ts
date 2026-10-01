import { prisma } from "@/lib/db/client";
import {
  getFollowerCountSeries,
  getUserInfo,
  getZernioFollowerSnapshots,
  type FollowerCountPoint,
  type InstagramContext,
} from "@/lib/instagram/provider";

export interface FollowerHistoryPoint {
  date: string; // YYYY-MM-DD
  followers: number;
  delta: number | null;
}

// Midnight UTC, so one calendar day maps to exactly one row.
function toUtcDay(value: Date | string): Date {
  const d = typeof value === "string" ? new Date(`${value}T00:00:00Z`) : value;
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  );
}

function toIsoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Idempotent per day, so the daily cron is safe to retry.
export async function recordFollowerSnapshot(
  instagramAccountId: string,
  followersCount: number
): Promise<void> {
  const date = toUtcDay(new Date());

  await prisma.followerSnapshot.upsert({
    where: { instagramAccountId_date: { instagramAccountId, date } },
    create: { instagramAccountId, date, followersCount, backfilled: false },
    // An observed count supersedes a backfilled estimate.
    update: { followersCount, backfilled: false },
  });
}

// Walks deltas backwards from today's total. Stops if the total goes negative
// (deltas disagree with the count): a short consistent history beats a wrong one.
export function reconstructFollowerTotals(
  series: FollowerCountPoint[],
  currentFollowers: number
): Array<{ date: string; followers: number }> {
  const ascending = [...series].sort((a, b) => a.date.localeCompare(b.date));
  const out: Array<{ date: string; followers: number }> = [];

  let running = currentFollowers;
  for (let i = ascending.length - 1; i >= 0; i--) {
    const point = ascending[i];
    if (running < 0) break;
    out.push({ date: point.date, followers: running });
    running -= point.delta;
  }

  return out.reverse();
}

// Derived rows are marked `backfilled` and never overwrite an observed snapshot.
// Returns days written; zero is expected for small or unsupported accounts.
export async function backfillFollowerHistory({
  instagramAccountId,
  accessToken,
  instagramId,
  currentFollowers,
}: {
  instagramAccountId: string;
  accessToken: InstagramContext;
  instagramId: string;
  currentFollowers: number;
}): Promise<number> {
  let points: { date: string; followers: number }[];
  try {
    if (accessToken.provider === "ZERNIO") {
      points = await getZernioFollowerSnapshots(accessToken);
    } else {
      const series = await getFollowerCountSeries({
        context: accessToken,
        igUserId: instagramId,
      });
      if (!series?.length) return 0;
      points = reconstructFollowerTotals(series, currentFollowers);
    }
  } catch {
    return 0;
  }
  const totals = points.map((t) => ({
    date: toUtcDay(t.date),
    followers: t.followers,
  }));
  if (!totals.length) return 0;

  const existing = await prisma.followerSnapshot.findMany({
    where: {
      instagramAccountId,
      date: { in: totals.map((t) => t.date) },
      backfilled: false,
    },
    select: { date: true },
  });
  const observed = new Set(existing.map((e) => toIsoDay(e.date)));

  const writable = totals.filter((t) => !observed.has(toIsoDay(t.date)));
  if (!writable.length) return 0;

  await prisma.$transaction(
    writable.map((t) =>
      prisma.followerSnapshot.upsert({
        where: {
          instagramAccountId_date: { instagramAccountId, date: t.date },
        },
        create: {
          instagramAccountId,
          date: t.date,
          followersCount: t.followers,
          backfilled: true,
        },
        update: { followersCount: t.followers, backfilled: true },
      })
    )
  );

  return writable.length;
}

export async function getFollowerHistory(
  instagramAccountId: string,
  days: number = 90
): Promise<FollowerHistoryPoint[]> {
  const since = toUtcDay(new Date());
  since.setUTCDate(since.getUTCDate() - Math.max(days, 1));

  const rows = await prisma.followerSnapshot.findMany({
    where: { instagramAccountId, date: { gte: since } },
    orderBy: { date: "asc" },
    select: { date: true, followersCount: true },
  });

  return rows.map((row, i) => ({
    date: toIsoDay(row.date),
    followers: row.followersCount,
    delta: i === 0 ? null : row.followersCount - rows[i - 1].followersCount,
  }));
}

// Called from the overview endpoint so the chart fills in before the next cron.
export async function ensureFollowerHistory(
  account: { id: string; instagramId: string },
  accessToken: InstagramContext
): Promise<number | null> {
  if (accessToken.provider === "ZERNIO") {
    await backfillFollowerHistory({
      instagramAccountId: account.id,
      accessToken,
      instagramId: account.instagramId,
      currentFollowers: 0,
    });
    const history = await getFollowerHistory(account.id);
    return history.at(-1)?.followers ?? null;
  }
  const info = await getUserInfo({ context: accessToken });
  const followers = info.followers_count;
  if (typeof followers !== "number") return null;

  await recordFollowerSnapshot(account.id, followers);

  const count = await prisma.followerSnapshot.count({
    where: { instagramAccountId: account.id },
  });
  if (count <= 1) {
    await backfillFollowerHistory({
      instagramAccountId: account.id,
      accessToken,
      instagramId: account.instagramId,
      currentFollowers: followers,
    });
  }

  return followers;
}
