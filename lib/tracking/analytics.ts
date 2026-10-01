const SKIPPED_PREFIX = "SKIPPED_";

export interface StatusCountRow {
  status: string;
  _count: number;
}

export interface KeywordCountRow {
  matchedKeyword: string | null;
  _count: number;
}

export function calculateCtr(clicks: number, sent: number) {
  if (sent <= 0) return 0;
  // Repeat clicks and link-preview bots can push clicks past sends; cap at 100%.
  return Math.min(100, Number(((clicks / sent) * 100).toFixed(1)));
}

export function summarizeDmStatuses(rows: StatusCountRow[]) {
  return rows.reduce(
    (summary, row) => {
      if (row.status === "SENT") summary.sent += row._count;
      if (row.status === "FAILED") summary.failed += row._count;
      if (row.status.startsWith(SKIPPED_PREFIX)) summary.skipped += row._count;
      return summary;
    },
    { sent: 0, skipped: 0, failed: 0 }
  );
}

export function normalizeTopKeywords(rows: KeywordCountRow[], limit = 5) {
  return rows
    .filter((row) => row.matchedKeyword)
    .map((row) => ({
      keyword: row.matchedKeyword as string,
      count: row._count,
    }))
    .sort((a, b) => b.count - a.count || a.keyword.localeCompare(b.keyword))
    .slice(0, limit);
}
