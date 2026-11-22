/*
 * Reading the server: every screen's data comes from a live request (transport/live/client.ts),
 * never from a fetch of its own.
 *
 * useLive<T>(path) → { data, status, loaded, fresh } — the latest answer to GET path: data is the
 *   body of a 200 (or the one kept from the last run until the first answer of this one arrives),
 *   status the HTTP status of the latest answer, loaded whether there is any answer to show, fresh
 *   whether it came from the server in this run. A null path subscribes to nothing.
 * livePath(path, query) — path with its query string, the key a live request is known by: two
 *   screens asking for the same thing share one subscription.
 *
 * Example:
 *   const { data } = useLive<ListChatsResponse>(livePath("/chat", { page_size: 50 }));
 *
 * Writes are ordinary requests (the mt client); a screen never patches what it shows after one,
 * because the server answers again by itself when the write changed what a live request returns.
 */
import { useCallback, useSyncExternalStore } from "react";
import { useSession } from "./session";

export function livePath(path: string, query?: Record<string, string | number | boolean | undefined | null>): string {
  const parts = Object.entries(query ?? {})
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `${path}?${parts.join("&")}` : path;
}

export function useLive<T>(path: string | null) {
  const { live } = useSession();
  const subscribe = useCallback(
    (changed: () => void) => (path ? live.subscribe(path, changed) : () => {}),
    [live, path],
  );
  const answer = useSyncExternalStore(subscribe, () => (path ? live.answer(path) : undefined));
  const ok = answer?.status === 200;
  return {
    data: ok ? (answer.body as T) : undefined,
    status: answer?.status,
    loaded: answer !== undefined,
    fresh: answer?.fresh ?? false,
  };
}
