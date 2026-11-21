/*
 * The phone key rows' modifiers.
 *
 * withMods(data, ctrl, alt): string — the bytes of a key, typed or tapped, with Ctrl and/or Alt
 *   applied as xterm sends them: a cursor or paging key gets the modifier parameter (Ctrl+← is
 *   ESC [1;5D, Alt+PgUp ESC [5;3~); with Ctrl a letter or one of @[\]^_ becomes its control
 *   character; Alt puts ESC before the key.
 *
 * Example: withMods("c", true, false) === "\x03"
 */
export function withMods(data: string, ctrl: boolean, alt: boolean): string {
  if (!ctrl && !alt) return data;
  const m = 1 + (alt ? 2 : 0) + (ctrl ? 4 : 0);
  const cursor = /^\x1b\[([A-DHF])$/.exec(data);
  if (cursor) return `\x1b[1;${m}${cursor[1]}`;
  const paging = /^\x1b\[([56])~$/.exec(data);
  if (paging) return `\x1b[${paging[1]};${m}~`;
  let out = data;
  if (ctrl && out.length === 1) {
    const c = out.toUpperCase().charCodeAt(0);
    if (c >= 0x40 && c <= 0x5f) out = String.fromCharCode(c & 0x1f);
  }
  return alt ? `\x1b${out}` : out;
}
