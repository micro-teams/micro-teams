import { useCallback, useEffect, useState } from "react";
import { getCache, setCache } from "@/lib/cache";

interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
  /** Optimistically set the data (and cache) from the current value. */
  mutate: (updater: (prev: T | null) => T) => void;
}

/**
 * Runs [fetcher] on mount and whenever [deps] change, tracking loading/error.
 * `reload()` re-runs it on demand (after a mutation). A stale-guard drops
 * results from a superseded run so fast navigation never flashes old data.
 *
 * Pass [cacheKey] to make it stale-while-revalidate: if something is cached under
 * that key we render it immediately (no spinner) and refetch in the background,
 * overwriting when the response arrives. The key MUST include everything the
 * fetcher depends on (e.g. `messages:${threadId}`); pass `undefined` to skip the
 * cache (e.g. while a required id is still null).
 */
export function useAsync<T>(
  fetcher: () => Promise<T>,
  deps: unknown[],
  cacheKey?: string,
): AsyncState<T> {
  const [data, setData] = useState<T | null>(() =>
    cacheKey ? getCache<T>(cacheKey) : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(() =>
    cacheKey ? getCache<T>(cacheKey) == null : true,
  );
  const [nonce, setNonce] = useState(0);

  // When the key changes (e.g. navigating to another thread) swap to the new
  // key's cache synchronously — React's "adjust state during render" pattern —
  // so we never show the previous key's data while the refetch runs.
  const [renderedKey, setRenderedKey] = useState(cacheKey);
  if (cacheKey !== renderedKey) {
    setRenderedKey(cacheKey);
    const cached = cacheKey ? getCache<T>(cacheKey) : null;
    setData(cached);
    setLoading(cached == null);
    setError(null);
  }

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const mutate = useCallback(
    (updater: (prev: T | null) => T) => {
      setData((prev) => {
        const next = updater(prev);
        if (cacheKey) setCache(cacheKey, next);
        return next;
      });
    },
    [cacheKey],
  );

  useEffect(() => {
    let active = true;
    setError(null);
    fetcher()
      .then((result) => {
        if (!active) return;
        setData(result);
        if (cacheKey) setCache(cacheKey, result);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce, cacheKey]);

  return { data, error, loading, reload, mutate };
}

export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
