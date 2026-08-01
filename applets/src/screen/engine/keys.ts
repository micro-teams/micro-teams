// VENDORED from micro-connector (applets/src/engine) — do not edit here.
// Update with applets/scripts/sync-connector.sh, which pins a commit.
// Keystrokes, and the two rules about writing them that were learned by breaking production.
export const ESC = '\x1b'
export const UP = ESC + '[A'
export const DOWN = ESC + '[B'
export const ENTER = '\r'
export const PGDN = ESC + '[6~'
export const SHIFT_TAB = ESC + '[Z'

// Bracketed paste. A body wrapped in these is ingested as ONE paste, so its embedded newlines are
// not read as submits. The closing Enter is never written in the same step — see submit.ts.
export const PASTE_START = ESC + '[200~'
export const PASTE_END = ESC + '[201~'
