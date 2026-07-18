// Mirrors cheese-auth server's users.service.ts validation exactly
// (isValidUsername/isValidNickname/isValidPassword + their *Rule getters) —
// read from source, not guessed, so client-side feedback never drifts from
// what the backend actually accepts.

export const usernamePattern = /^[a-zA-Z0-9_-]{4,32}$/;
export const usernameRule =
  "Username must be 4-32 characters long and can only contain letters, numbers, underscores and hyphens.";

export const nicknamePattern = /^[a-zA-Z0-9_\u4e00-\u9fa5]{1,16}$/;
export const nicknameRule =
  "Nickname must be 1-16 characters long and can only contain letters, numbers, underscores, and Chinese characters.";

// eslint-disable-next-line no-control-regex
export const passwordPattern =
  /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[\x21-\x2F\x3A-\x40\x5B-\x60\x7B-\x7E]).{8,}$/;
export const passwordRule =
  "Password must be at least 8 characters long and must contain at least one letter, one digit, and one special character.";

export interface PasswordChecks {
  length: boolean;
  letter: boolean;
  digit: boolean;
  special: boolean;
}

// eslint-disable-next-line no-control-regex
const specialCharPattern = /[\x21-\x2F\x3A-\x40\x5B-\x60\x7B-\x7E]/;

export function checkPassword(password: string): PasswordChecks {
  return {
    length: password.length >= 8,
    letter: /[a-zA-Z]/.test(password),
    digit: /\d/.test(password),
    special: specialCharPattern.test(password),
  };
}
