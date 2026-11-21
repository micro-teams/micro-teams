// The phone key rows' modifiers, as xterm sends them.
import { withMods } from "./keys";

test("without modifiers a key is itself", () => {
  expect(withMods("\x1b[A", false, false)).toBe("\x1b[A");
});

test("Ctrl makes a control character", () => {
  expect(withMods("c", true, false)).toBe("\x03");
  expect(withMods("[", true, false)).toBe("\x1b");
  expect(withMods("1", true, false)).toBe("1");
});

test("Alt puts ESC first", () => {
  expect(withMods("b", false, true)).toBe("\x1bb");
  expect(withMods("c", true, true)).toBe("\x1b\x03");
});

test("cursor and paging keys take the modifier parameter", () => {
  expect(withMods("\x1b[D", true, false)).toBe("\x1b[1;5D");
  expect(withMods("\x1b[H", false, true)).toBe("\x1b[1;3H");
  expect(withMods("\x1b[5~", false, true)).toBe("\x1b[5;3~");
  expect(withMods("\x1b[6~", true, true)).toBe("\x1b[6;7~");
});
