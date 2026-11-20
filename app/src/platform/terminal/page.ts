/*
 * The terminal itself, in a page: xterm.js mounted on an element, shown at exactly the size the
 * machine says, centred in the room the element has. The same code runs in the web build's own
 * document and, bundled by tool/terminal-html.mjs, inside the WebView a phone draws it in.
 *
 * mountTerminal(el, post, opts) → TerminalHandle. post receives FromTerminal:
 *   { type: "room", cols, rows }  how many cells the element has room for: once at mount, then
 *                                 after each change of the element's size has settled.
 *   { type: "keys", data }        what the person typed, pasted, or did with the mouse (mouse
 *                                 sequences, the wheel among them, only while tmux asks for them).
 *   { type: "rendered", n }       n more bytes of screen data have been drawn; the machine sends
 *                                 more only as these arrive.
 *   { type: "copy", text }        text for the clipboard: a program's OSC 52 (tmux sends one when a
 *                                 drag selects in it) or the local selection copied with Ctrl+C.
 * The handle: write(bytes) draws screen bytes; size(cols, rows) sets the terminal's size, taking
 * effect after everything written before it; reset() starts a new stream on a clean terminal;
 * focus(on) takes or gives up the keyboard; dispose().
 *
 * The terminal is never taller than the element and never scrolls on its own: there is no
 * scrollback, and the wheel reaches tmux as mouse input or does nothing. A finger dragged over it is
 * turned into wheel turns for the same reason, and a tap takes the keyboard. While the element is
 * smaller than the terminal (it has just shrunk, and the machine has not answered with the new
 * size), nothing new is drawn and the terminal keeps its bottom edge, where a program's prompt is,
 * in view; after a growth it keeps its place until the new size arrives. Otherwise it is centred
 * both ways.
 *
 * Black is black and white is white: the ANSI sixteen are xterm's defaults, the colours a program
 * picked on purpose.
 *
 * Example: const t = mountTerminal(div, (m) => handle(m), { fontFamily: "monospace" }); t.size(80, 24);
 */
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";

export type FromTerminal =
  | { type: "room"; cols: number; rows: number }
  | { type: "keys"; data: string }
  | { type: "rendered"; n: number }
  | { type: "copy"; text: string };

export interface TerminalHandle {
  write(bytes: Uint8Array): void;
  size(cols: number, rows: number): void;
  reset(): void;
  focus(on: boolean): void;
  dispose(): void;
}

/** A change of the element's size counts once it has held this long: one step, not every frame. */
const SETTLE_MS = 60;
/** How long a terminal waits, held, for the size answering a shrink before it draws again. */
const HOLD_MS = 2_000;
/** Rendered bytes are reported in batches, at least this often. */
const ACK_MS = 50;
const ACK_BYTES = 32 * 1024;
/** A finger travelling this many cells is one wheel turn (tmux scrolls a few lines per turn). */
const CELLS_PER_TURN = 2;
const TAP_SLOP_PX = 8;

const THEME = {
  cursor: "#FFFFFF",
  selectionBackground: "#FFFFFF40",
  foreground: "#FFFFFF",
  background: "#000000",
  black: "#000000",
  red: "#CD3131",
  green: "#0DBC79",
  yellow: "#E5E510",
  blue: "#2472C8",
  magenta: "#BC3FBC",
  cyan: "#11A8CD",
  white: "#E5E5E5",
  brightBlack: "#666666",
  brightRed: "#F14C4C",
  brightGreen: "#23D18B",
  brightYellow: "#F5F543",
  brightBlue: "#3B8EEA",
  brightMagenta: "#D670D6",
  brightCyan: "#29B8DB",
  brightWhite: "#FFFFFF",
};

export function mountTerminal(el: HTMLElement, post: (m: FromTerminal) => void, opts: { fontFamily: string; fontSize?: number }): TerminalHandle {
  const box = document.createElement("div");
  box.style.cssText = "position:absolute;inset:0;overflow:hidden;background:#000";
  el.appendChild(box);
  const term = new Terminal({
    scrollback: 0,
    fontFamily: opts.fontFamily,
    fontSize: opts.fontSize ?? 13,
    theme: THEME,
    cursorBlink: false,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  // Reading the clipboard is never offered to a program on the machine: only writing it.
  term.loadAddon(new ClipboardAddon(undefined, { readText: () => "", writeText: (_s, text) => post({ type: "copy", text }) }));
  term.open(box);
  const xterm = term.element!;
  xterm.style.position = "absolute";

  term.onData((data) => post({ type: "keys", data }));
  term.onBinary((data) => post({ type: "keys", data }));
  // With no mouse reporting the wheel would become arrow keys in a full-screen program: it is
  // dropped instead, since scrolling is tmux's.
  term.attachCustomWheelEventHandler(() => term.modes.mouseTrackingMode !== "none");
  term.attachCustomKeyEventHandler((e) => {
    const copy = e.type === "keydown" && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c" && term.hasSelection();
    if (copy) {
      post({ type: "copy", text: term.getSelection() });
      term.clearSelection();
    }
    return !copy;
  });

  // -- acknowledging what was drawn -------------------------------------------
  let unacked = 0;
  let ackTimer: ReturnType<typeof setTimeout> | null = null;
  const flushAck = () => {
    if (ackTimer) clearTimeout(ackTimer);
    ackTimer = null;
    if (unacked > 0) post({ type: "rendered", n: unacked });
    unacked = 0;
  };
  const drawn = (n: number) => {
    unacked += n;
    if (unacked >= ACK_BYTES) flushAck();
    else if (!ackTimer) ackTimer = setTimeout(flushAck, ACK_MS);
  };
  const draw = (bytes: Uint8Array) => {
    // A terminal emulator parses whatever a program nobody here controls prints; one sequence it
    // mishandles must cost the rendering of one chunk, never the session.
    try {
      term.write(bytes, () => drawn(bytes.length));
    } catch (e) {
      console.warn(`terminal: dropped a chunk the emulator could not parse: ${String(e)}`);
      drawn(bytes.length);
    }
  };

  // -- room, size and placement ------------------------------------------------
  let room = { cols: 0, rows: 0 };
  let held: Uint8Array[] | null = null;
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let growing = false;
  let top = 0;
  const place = () => {
    const w = box.clientWidth;
    const h = box.clientHeight;
    const tw = xterm.offsetWidth;
    const th = xterm.offsetHeight;
    if (held) top = h - th;
    else if (!growing || th > h) top = Math.floor((h - th) / 2);
    xterm.style.left = `${Math.max(0, Math.floor((w - tw) / 2))}px`;
    xterm.style.top = `${top}px`;
  };
  const release = () => {
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = null;
    const queued = held ?? [];
    held = null;
    for (const b of queued) draw(b);
  };
  const measure = () => {
    const d = fit.proposeDimensions();
    if (!d || !d.cols || !d.rows) return;
    if (d.cols === room.cols && d.rows === room.rows) return place();
    room = { cols: d.cols, rows: d.rows };
    if (room.cols < term.cols || room.rows < term.rows) {
      held ??= [];
      if (holdTimer) clearTimeout(holdTimer);
      holdTimer = setTimeout(() => {
        console.warn(`terminal: no size came for the room ${room.cols}x${room.rows}; drawing again`);
        release();
        place();
      }, HOLD_MS);
    } else {
      // Another viewer may keep the window smaller: then no size comes, and it is centred again.
      growing = true;
      if (holdTimer) clearTimeout(holdTimer);
      holdTimer = setTimeout(() => {
        growing = false;
        place();
      }, HOLD_MS);
    }
    place();
    post({ type: "room", ...room });
  };
  let settle: ReturnType<typeof setTimeout> | null = null;
  const observer = new ResizeObserver(() => {
    if (settle) clearTimeout(settle);
    settle = setTimeout(measure, SETTLE_MS);
  });
  observer.observe(box);
  measure();

  // -- the finger: wheel turns and taps ---------------------------------------
  let start: { x: number; y: number } | null = null;
  let lastY = 0;
  let travel = 0;
  let moved = false;
  const cellHeight = () => xterm.offsetHeight / Math.max(1, term.rows);
  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    if (!t || e.touches.length > 1) return;
    start = { x: t.clientX, y: t.clientY };
    lastY = t.clientY;
    travel = 0;
    moved = false;
  };
  const onTouchMove = (e: TouchEvent) => {
    const t = e.touches[0];
    if (!t || !start) return;
    e.preventDefault();
    if (Math.abs(t.clientY - start.y) > TAP_SLOP_PX || Math.abs(t.clientX - start.x) > TAP_SLOP_PX) moved = true;
    travel += t.clientY - lastY;
    lastY = t.clientY;
    const turn = cellHeight() * CELLS_PER_TURN;
    const target = xterm.querySelector(".xterm-screen") ?? xterm;
    while (Math.abs(travel) >= turn) {
      // Dragging down shows what is above, as pulling a page down does: a wheel turned up.
      const up = travel > 0;
      travel += up ? -turn : turn;
      target.dispatchEvent(
        new WheelEvent("wheel", { deltaY: up ? -turn : turn, deltaMode: 0, clientX: t.clientX, clientY: t.clientY, bubbles: true, cancelable: true }),
      );
    }
  };
  const onTouchEnd = (e: TouchEvent) => {
    if (!start) return;
    // A tap is for the keyboard, not a click for the program: the browser's synthesized mouse
    // events are cancelled.
    e.preventDefault();
    if (!moved) term.focus();
    start = null;
  };
  box.addEventListener("touchstart", onTouchStart, { passive: true, capture: true });
  box.addEventListener("touchmove", onTouchMove, { passive: false, capture: true });
  box.addEventListener("touchend", onTouchEnd, { passive: false, capture: true });

  return {
    write: (bytes) => {
      if (held) held.push(bytes);
      else draw(bytes);
    },
    size: (cols, rows) => {
      release();
      // After everything written before it, so earlier bytes are read at the size they were sent
      // for, and before anything written after it.
      term.write(new Uint8Array(0), () => {
        if (cols !== term.cols || rows !== term.rows) term.resize(cols, rows);
        growing = false;
        place();
      });
    },
    reset: () => {
      release();
      term.reset();
    },
    focus: (on) => (on ? term.focus() : term.blur()),
    dispose: () => {
      observer.disconnect();
      for (const t of [settle, holdTimer, ackTimer]) if (t) clearTimeout(t);
      box.removeEventListener("touchstart", onTouchStart, { capture: true });
      box.removeEventListener("touchmove", onTouchMove, { capture: true });
      box.removeEventListener("touchend", onTouchEnd, { capture: true });
      term.dispose();
      box.remove();
    },
  };
}
