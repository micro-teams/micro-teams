/*
 * How times are written in the chat list and between messages.
 *
 * Run with `npm test`. Times are built in the reader's own zone, so the cases hold in any zone.
 */
import { listTime, needsSeparator, separatorTime } from "./time";

const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi).toISOString();
const now = new Date(2026, 10, 15, 18, 0);

test("today shows a clock, another day a date", () => {
  expect(listTime(at(2026, 11, 15, 9, 5), now)).toBe("09:05");
  expect(listTime(at(2026, 11, 3, 9, 5), now)).toBe("11/03");
});

test("a separator on another day carries the date and the clock", () => {
  expect(separatorTime(at(2026, 11, 3, 9, 5), now)).toBe("11/03 09:05");
});

test("a new stretch starts after more than five minutes", () => {
  expect(needsSeparator(undefined, at(2026, 11, 15, 9, 0))).toBe(true);
  expect(needsSeparator(at(2026, 11, 15, 9, 0), at(2026, 11, 15, 9, 5))).toBe(false);
  expect(needsSeparator(at(2026, 11, 15, 9, 0), at(2026, 11, 15, 9, 6))).toBe(true);
});
