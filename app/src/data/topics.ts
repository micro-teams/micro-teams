/*
 * Watching a topic of the updates socket from a data hook: refetch when the server says it moved,
 * and answer the periodic check with what the hook holds.
 *
 * useTopic(topic, onChange, digest?) — subscribes while the calling component is mounted. onChange
 *   receives why (an event, a hole, a gap, a reconnect, a mismatch); digest() returns what is held,
 *   in the server's digest form, or null while loading.
 * threadTopic(id), chatsTopic(userId) — topic names, built here and nowhere else, mirroring the
 *   backend's Topic.kt.
 * threadDigest(messages, window) — "lastId:count" over the newest `window` messages, as the
 *   backend's ThreadQuery digests the same window.
 *
 * Example: useTopic(threadTopic(5), () => refetch(), () => threadDigest(held, 100));
 *
 * Only hooks in src/data watch topics; a screen that could subscribe by itself would be a screen
 * holding data, and then there would be two paths to the pixels.
 */
import { useEffect, useRef } from "react";
import type { SyncReason } from "../transport/updates/store";
import type { Message } from "./merge";
import { useSession } from "./session";

export const threadTopic = (id: number) => `thread:${id}`;
export const chatsTopic = (userId: number) => `chats:${userId}`;

export function threadDigest(messages: readonly Message[], window: number): string {
  if (!messages.length) return "empty";
  const page = messages.slice(-window);
  return `${page[page.length - 1].id}:${page.length}`;
}

export function useTopic(topic: string | null, onChange: (reason: SyncReason) => void, digest?: () => string | null) {
  const { updates } = useSession();
  // The latest callbacks, without resubscribing on every render.
  const latest = useRef({ onChange, digest });
  useEffect(() => {
    latest.current = { onChange, digest };
  });
  useEffect(() => {
    if (!topic) return;
    return updates.subscribe(topic, {
      onChange: (r) => latest.current.onChange(r),
      digest: () => latest.current.digest?.() ?? null,
    });
  }, [updates, topic]);
}
