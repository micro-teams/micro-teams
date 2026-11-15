/*
 * Member ids typed or pasted into "new chat".
 *
 * Run with `npm test`.
 */
import { parseMemberIds } from "./chats";

test("ids separated by commas or spaces; anything else is dropped", () => {
  expect(parseMemberIds("12, 34 56")).toEqual([12, 34, 56]);
  expect(parseMemberIds(" 7，8,, x 9.5 -1 ")).toEqual([7, 8]);
  expect(parseMemberIds("")).toEqual([]);
});
