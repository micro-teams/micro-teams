// A small stale-while-revalidate cache for the app's reads.
//
// Everything the UI fetches (via useAsync, plus the two message pollers) writes
// its result here under a stable key. On the next mount the UI paints the cached
// value immediately and revalidates in the background, so navigating back to a
// screen you've already seen shows content at once instead of a spinner.
//
// Two layers:
//   * in-memory Map — the source of truth for the running session.
//   * localStorage mirror — so a full page reload can paint from disk before the
//     network answers. Scoped to the signed-in user (see setCacheScope): a
//     different user (or sign-out) purges everything, so one account never paints
//     another's data. Entries older than TTL are ignored on read.
//
// All persistence is best-effort: any miss / quota / parse error just falls back
// to a normal fetch.

const MEM = new Map<string, unknown>();
const LS_PREFIX = "mt:cache:v1:";
const SCOPE_KEY = "mt:cache:scope";
const TTL_MS = 12 * 60 * 60 * 1000; // ignore persisted entries older than 12h

// Initialised from disk at module load so a reload can read the cache before the
// auth layer has re-confirmed the user (setCacheScope reconciles right after).
let scope: string | null = readScope();

function readScope(): string | null {
  try {
    return localStorage.getItem(SCOPE_KEY);
  } catch {
    return null;
  }
}

function lsKey(key: string): string {
  return `${LS_PREFIX}${scope}:${key}`;
}

export function getCache<T>(key: string): T | null {
  if (MEM.has(key)) return MEM.get(key) as T;
  if (scope == null) return null;
  try {
    const raw = localStorage.getItem(lsKey(key));
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw) as { data: T; ts: number };
    if (Date.now() - ts > TTL_MS) return null;
    MEM.set(key, data);
    return data;
  } catch {
    return null;
  }
}

export function setCache<T>(key: string, data: T): void {
  MEM.set(key, data);
  if (scope == null) return;
  try {
    localStorage.setItem(lsKey(key), JSON.stringify({ data, ts: Date.now() }));
  } catch {
    // quota exceeded / not serialisable — the in-memory copy still works.
  }
}

export function invalidateCache(key: string): void {
  MEM.delete(key);
  if (scope == null) return;
  try {
    localStorage.removeItem(lsKey(key));
  } catch {
    // ignore
  }
}

function purgeAllPersisted(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LS_PREFIX)) localStorage.removeItem(k);
    }
  } catch {
    // ignore
  }
}

/**
 * Point the cache at the currently signed-in user. Call on login, on the boot
 * session-restore, and on logout (with null).
 *
 * Same user across a reload keeps the on-disk cache. A DIFFERENT user, or a
 * sign-out, clears the whole cache (memory + disk) so no account ever sees
 * another's cached data.
 */
export function setCacheScope(userId: string | number | null): void {
  const next = userId == null ? null : String(userId);
  const persisted = readScope();
  if (next == null) {
    MEM.clear();
    purgeAllPersisted();
    try {
      localStorage.removeItem(SCOPE_KEY);
    } catch {
      // ignore
    }
    scope = null;
    return;
  }
  if (persisted != null && persisted !== next) {
    // a different user signed in on this browser — drop the previous user's cache
    MEM.clear();
    purgeAllPersisted();
  }
  scope = next;
  try {
    localStorage.setItem(SCOPE_KEY, next);
  } catch {
    // ignore
  }
}
