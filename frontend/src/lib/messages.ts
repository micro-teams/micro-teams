// How a thread's message list is assembled from two different sources.
//
// A chat pane reads the server two ways at once: a 4s poll that always asks for the NEWEST page,
// and — when the user scrolls up — cursor pages walking backwards through history. Both write into
// one list, so the merge rules live here, as plain functions over ids, where they can be tested
// without a browser.
//
// The rule that matters: the newest page is the server's truth only for the range it covers. Older
// messages the poll no longer returns are not gone — they are simply off the page — so they are
// kept. Replacing the whole list with each poll (what the panes used to do) silently threw away
// every older page the user had just scrolled up to load.

import type { Message } from "@/api";

const byId = (a: Message, b: Message) => a.id - b.id;

/**
 * Fold a freshly polled newest page into what we already have.
 *
 * Everything older than the page's first id is kept as-is (loaded history, plus anything that fell
 * off the page as new messages arrived — otherwise a gap would open there); everything inside the
 * page's range comes from the page, so an edit or a delete in the recent window still propagates.
 */
export function mergeNewestPage(known: Message[], page: Message[]): Message[] {
  if (page.length === 0) return known;
  const floor = page[0].id;
  const older = known.filter((m) => m.id < floor);
  return [...older, ...[...page].sort(byId)];
}

/** Fold an older cursor page in, ignoring ids we already hold (pages can overlap). */
export function mergeOlderPage(known: Message[], page: Message[]): Message[] {
  const have = new Set(known.map((m) => m.id));
  const added = page.filter((m) => !have.has(m.id));
  if (added.length === 0) return known;
  return [...added, ...known].sort(byId);
}
