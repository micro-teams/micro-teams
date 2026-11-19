/*
 * Which team the docs and agents sections open on: never one that has gone.
 *
 * Run with `npm test`.
 */
import { pickTeam } from "./teams";

const teams = [
  { id: 1, name: "a" },
  { id: 2, name: "b" },
];

test("the current team stays while it exists", () => {
  expect(pickTeam(teams, 2, 1)).toBe(2);
});

test("a team that has gone gives way to the remembered one, then the first", () => {
  expect(pickTeam(teams, 9, 2)).toBe(2);
  expect(pickTeam(teams, 9, 8)).toBe(1);
  expect(pickTeam(teams, null, null)).toBe(1);
});

test("no teams, no team", () => {
  expect(pickTeam([], 1, 1)).toBeNull();
});
