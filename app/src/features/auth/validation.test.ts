/*
 * The server's rules, said before the server has to.
 *
 * Run with `npm test`.
 */
import { isValidUsername, passwordChecks } from "./validation";

test("usernames: 4 to 32 of letters, digits, _ and -", () => {
  expect(isValidUsername("ab_c-1")).toBe(true);
  expect(isValidUsername("abc")).toBe(false);
  expect(isValidUsername("a".repeat(33))).toBe(false);
  expect(isValidUsername("üserñame")).toBe(false);
});

test("passwords: each rule on its own", () => {
  expect(passwordChecks("Passw0rd!x").allMet).toBe(true);
  expect(passwordChecks("password").rules.map((r) => r.met)).toEqual([true, true, false, false]);
  expect(passwordChecks("pass word1").rules[3].met).toBe(false);
  expect(passwordChecks("a1~").rules.map((r) => r.met)).toEqual([false, true, true, true]);
});
