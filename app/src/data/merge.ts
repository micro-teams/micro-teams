/*
 * How a conversation's messages are assembled from the two ways it is read: the newest page,
 * fetched again every few seconds, and older pages walked backwards as the reader scrolls up.
 *
 * mergeNewest(held, page) — inside the page's range the page wins (an edit, a delete or a message
 *   found undelivered there propagates); everything below it that is held stays, so scrolled-up
 *   history is never dropped.
 * mergeOlder(held, page) — folds an older page in, ignoring ids already held (pages may overlap).
 * Message — one stored message, as the backend sends it.
 *
 * Example: setMessages((held) => mergeNewest(held, page.messages));
 *
 * Plain functions over ids, kept apart from the hooks that call them so they can be tested
 * without a device.
 */
import type { Schema } from "../api/client";

export type Message = Schema["Message"];

/** Folds a freshly fetched newest page into what is held: inside its range the page wins, below
 * it everything already held stays. */
export function mergeNewest(held: Message[], page: Message[]): Message[] {
  if (!page.length) return held;
  const sorted = [...page].sort((a, b) => a.id - b.id);
  // Nothing new — the usual answer to a refetch — keeps the very same array, so nothing on screen
  // is told to lay itself out again.
  const tail = held.slice(-sorted.length);
  const before = held[held.length - sorted.length - 1];
  if (tail.length === sorted.length && sorted.every((m, i) => same(m, tail[i])) && (!before || before.id < sorted[0].id)) return held;
  return [...held.filter((m) => m.id < sorted[0].id), ...sorted];
}

function same(a: Message, b: Message | undefined): boolean {
  return (
    !!b &&
    a.id === b.id &&
    a.content === b.content &&
    a.editedAt === b.editedAt &&
    (a.undelivered?.length ?? 0) === (b.undelivered?.length ?? 0)
  );
}

/** Folds an older page in, dropping ids already held (pages may overlap). */
export function mergeOlder(held: Message[], page: Message[]): Message[] {
  const have = new Set(held.map((m) => m.id));
  return [...page.filter((m) => !have.has(m.id)), ...held].sort((a, b) => a.id - b.id);
}
