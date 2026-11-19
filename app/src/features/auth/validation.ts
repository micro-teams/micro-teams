/*
 * What cheese-auth will accept, said here so the form can say it first.
 *
 * isValidUsername(u) and passwordChecks(p) mirror the server's users.service.ts (isValidUsername,
 * isValidPassword) and its rule strings — read from that source, not guessed: a form that calls a
 * password fine and then fails on submit teaches people not to trust it. passwordChecks reports the
 * four rules separately, because the useful thing to show is which one is not met yet.
 *
 * USERNAME_RULE — the username rule in words, as cheese-auth states it.
 *
 * Example: passwordChecks("abc").rules → [{ label: "at least 8 characters", met: false }, ...]
 */
export const USERNAME_RULE = "Username must be 4-32 characters long and can only contain letters, numbers, underscores and hyphens.";

export const isValidUsername = (u: string) => /^[a-zA-Z0-9_-]{4,32}$/.test(u);

export function passwordChecks(p: string) {
  const rules = [
    { label: "at least 8 characters", met: p.length >= 8 },
    { label: "a letter", met: /[a-zA-Z]/.test(p) },
    { label: "a digit", met: /\d/.test(p) },
    // Printable ASCII punctuation — the server's \x21-\x2F\x3A-\x40\x5B-\x60\x7B-\x7E.
    { label: "a special character", met: /[!-/:-@[-`{-~]/.test(p) },
  ];
  return { rules, allMet: rules.every((r) => r.met) };
}
