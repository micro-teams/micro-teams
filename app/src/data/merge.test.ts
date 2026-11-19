/*
 * How a conversation's pages are folded together.
 *
 * Run with `npm test`. These rules keep scrolled-up history from being thrown away when the newest
 * page is fetched again.
 */
import { mergeNewest, mergeOlder, Message } from "./merge";

const m = (id: number): Message => ({ id, threadId: 1, senderId: 1, content: `m${id}`, createdAt: "2026-11-15T00:00:00Z" });
const ids = (list: Message[]) => list.map((x) => x.id);

test("the newest page replaces its own range and keeps the history below it", () => {
  expect(ids(mergeNewest([m(1), m(2), m(3)], [m(3), m(4)]))).toEqual([1, 2, 3, 4]);
});

test("a message deleted inside the newest page's range goes", () => {
  expect(ids(mergeNewest([m(1), m(2), m(3)], [m(2), m(4)]))).toEqual([1, 2, 4]);
});

test("an older page is folded in without duplicates", () => {
  expect(ids(mergeOlder([m(3), m(4)], [m(1), m(2), m(3)]))).toEqual([1, 2, 3, 4]);
});

test("a refetch with nothing new keeps the same array", () => {
  const held = mergeNewest([], [m(1), m(2), m(3)]);
  expect(mergeNewest(held, [m(2), m(3)])).toBe(held);
  expect(mergeNewest(held, [m(2), m(4)])).not.toBe(held);
});
