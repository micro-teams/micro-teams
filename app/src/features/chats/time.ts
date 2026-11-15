/*
 * How a time is written in the chat list and between messages.
 *
 * listTime(iso, now?) — the list's stamp: a clock today ("14:05"), a date before ("11/03").
 * separatorTime(iso, now?) — between messages: a clock today, a date and a clock before
 *   ("11/03 14:05").
 * needsSeparator(previousIso, iso) — whether a message opens a new stretch: more than five minutes
 *   after the one before it, or the first one.
 *
 * Example: listTime("2026-11-15T06:05:00Z") → "14:05" for a reader in UTC+8 on that day.
 *
 * Kept in one place so the rule is written once; the server's timestamps are UTC and are shown in
 * the reader's own time zone.
 */

const GAP_MS = 5 * 60 * 1000;

function parse(iso: string): Date {
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
}

const two = (n: number) => String(n).padStart(2, "0");
const clock = (d: Date) => `${two(d.getHours())}:${two(d.getMinutes())}`;
const date = (d: Date) => `${two(d.getMonth() + 1)}/${two(d.getDate())}`;
const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function listTime(iso: string | undefined, now = new Date()): string {
  if (!iso) return "";
  const d = parse(iso);
  return sameDay(d, now) ? clock(d) : date(d);
}

export function separatorTime(iso: string, now = new Date()): string {
  const d = parse(iso);
  return sameDay(d, now) ? clock(d) : `${date(d)} ${clock(d)}`;
}

export function needsSeparator(previous: string | undefined, iso: string): boolean {
  return previous === undefined || parse(iso).getTime() - parse(previous).getTime() > GAP_MS;
}
