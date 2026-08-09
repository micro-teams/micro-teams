// What these cover is the failure that looks fine: the list still shows messages, in order, with
// nothing on screen to say that the history the user just scrolled up to load was dropped by the
// next 4s poll. Each case below is one way that used to happen.

import { describe, expect, it } from "vitest";

import { mergeNewestPage, mergeOlderPage } from "./merge";
import type { Message } from "@/api";

const msg = (id: number, content = `m${id}`): Message =>
  ({ id, threadId: 1, senderId: 1, content, createdAt: "" }) as Message;

const ids = (list: Message[]) => list.map((m) => m.id);

describe("mergeNewestPage", () => {
  it("keeps older history the newest page no longer covers", () => {
    const known = [msg(1), msg(2), msg(3), msg(4)];
    expect(ids(mergeNewestPage(known, [msg(3), msg(4)]))).toEqual([1, 2, 3, 4]);
  });

  it("keeps messages that fall off the page as new ones arrive — no gap", () => {
    // Page size 2. We hold 1..4; two new messages land, so the page is now 5,6 and 3,4 have
    // dropped off it. They are still real messages and must stay.
    const known = [msg(1), msg(2), msg(3), msg(4)];
    expect(ids(mergeNewestPage(known, [msg(5), msg(6)]))).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
  });

  it("lets the page correct what it does cover (edit / delete in the recent window)", () => {
    const known = [msg(1), msg(2, "typo"), msg(3)];
    const merged = mergeNewestPage(known, [msg(2, "fixed")]);
    expect(ids(merged)).toEqual([1, 2]); // 3 deleted server-side, and it goes
    expect(merged[1].content).toBe("fixed");
  });

  it("keeps what we have when the page comes back empty", () => {
    const known = [msg(1), msg(2)];
    expect(ids(mergeNewestPage(known, []))).toEqual([1, 2]);
  });
});

describe("mergeOlderPage", () => {
  it("prepends an older page in ascending order", () => {
    expect(ids(mergeOlderPage([msg(5), msg(6)], [msg(3), msg(4)]))).toEqual([
      3, 4, 5, 6,
    ]);
  });

  it("ignores ids already held, so overlapping pages never duplicate", () => {
    expect(ids(mergeOlderPage([msg(4), msg(5)], [msg(3), msg(4)]))).toEqual([
      3, 4, 5,
    ]);
  });

  it("returns the same list when the page adds nothing", () => {
    const known = [msg(4), msg(5)];
    expect(mergeOlderPage(known, [msg(4)])).toBe(known);
  });
});
