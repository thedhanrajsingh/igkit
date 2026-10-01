// Stale-while-revalidate cache in sessionStorage for slow Instagram calls.

interface Entry<T> {
  data: T;
  ts: number;
}

export function readCache<T>(
  key: string,
  maxAgeMs: number
): { data: T | null; stale: boolean } {
  if (typeof window === "undefined") return { data: null, stale: true };
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return { data: null, stale: true };
    const entry = JSON.parse(raw) as Entry<T>;
    return { data: entry.data, stale: Date.now() - entry.ts > maxAgeMs };
  } catch {
    return { data: null, stale: true };
  }
}

export function writeCache<T>(key: string, data: T): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      key,
      JSON.stringify({ data, ts: Date.now() })
    );
  } catch {
    // Storage full or unavailable, caching is best-effort.
  }
}
