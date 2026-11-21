/*
 * The thread digest the client answers the server's periodic check with. It must equal what the
 * backend's ThreadQuery computes over the same messages, or every check would refetch.
 *
 * Run with `npm test`.
 */
import type { Message } from "./merge";
import { threadDigest } from "./topics";

const m = (id: number, undelivered = 0): Message => ({
  id,
  threadId: 1,
  senderId: 1,
  content: `m${id}`,
  createdAt: "2026-11-15T00:00:00Z",
  undelivered: Array.from({ length: undelivered }, (_, i) => ({ userId: i, reason: "gone" })),
});

test("newest id and count over the window, as the server digests it", () => {
  expect(threadDigest([], 100)).toBe("empty");
  expect(threadDigest([m(1), m(2), m(3)], 2)).toBe("3:2");
});

test("undelivered entries in the window are counted only when there are any", () => {
  expect(threadDigest([m(1, 1), m(2), m(3, 2)], 100)).toBe("3:3:u3");
  expect(threadDigest([m(1, 1), m(2), m(3)], 2)).toBe("3:2");
});
