/*
 * The terminal itself, in a page: xterm.js mounted on an element, the gestures that page tmux
 * history, and what it tells its host. The same code runs in the web build's own document and,
 * bundled by tool/terminal-html.mjs, inside the WebView a phone draws it in.
 *
 * mountTerminal(el, post, opts) → TerminalHandle — post receives { type: "keys", data },
 *   { type: "resize", cols, rows } and { type: "scroll", dir: "up" | "down" }. The handle writes
 *   screen bytes, switches typing on and off (off: the keyboard is not taken and nothing typed
 *   reaches post), refits after a size change, and disposes.
 *
 * Scrolling is not local. The program on the screen keeps no scrollback, the history lives in tmux,
 * so a wheel turn or a drag becomes scroll steps (one per 40 px, dragging down reveals earlier
 * output, as pulling a page down shows what is above it) and the terminal's own tiny buffer never
 * scrolls. Black is black and white is white: the ANSI sixteen are xterm's defaults, the colours a
 * program picked on purpose.
 */
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";

export type FromTerminal = { type: "keys"; data: string } | { type: "resize"; cols: number; rows: number } | { type: "scroll"; dir: "up" | "down" };

export interface TerminalHandle {
  write(bytes: Uint8Array): void;
  setTyping(on: boolean): void;
  fit(): void;
  dispose(): void;
}

const STEP = 40;

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
  // A deliberately tiny scrollback: tmux owns the history, and a big local buffer would be a second,
  // disagreeing copy of it.
  const term = new Terminal({
    scrollback: 64,
    fontFamily: opts.fontFamily,
    fontSize: opts.fontSize ?? 13,
    theme: THEME,
    disableStdin: true,
    cursorBlink: false,
    allowProposedApi: false,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(el);
  let typing = false;
  term.onData((data) => typing && post({ type: "keys", data }));
  term.onResize(({ cols, rows }) => post({ type: "resize", cols, rows }));

  let pending = 0;
  const step = (dy: number) => {
    pending += dy;
    while (Math.abs(pending) >= STEP) {
      const up = pending > 0;
      post({ type: "scroll", dir: up ? "up" : "down" });
      pending += up ? -STEP : STEP;
    }
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    step(-e.deltaY);
  };
  let lastY: number | null = null;
  const onTouchStart = (e: TouchEvent) => (lastY = e.touches[0]?.clientY ?? null);
  const onTouchMove = (e: TouchEvent) => {
    const y = e.touches[0]?.clientY;
    if (y === undefined || lastY === null) return;
    e.preventDefault();
    step(y - lastY);
    lastY = y;
  };
  el.addEventListener("wheel", onWheel, { passive: false, capture: true });
  el.addEventListener("touchstart", onTouchStart, { passive: true, capture: true });
  el.addEventListener("touchmove", onTouchMove, { passive: false, capture: true });

  const refit = () => {
    try {
      fit.fit();
    } catch {
      // not laid out yet
    }
  };
  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(refit);
  observer?.observe(el);
  refit();
  post({ type: "resize", cols: term.cols, rows: term.rows });

  return {
    write: (bytes) => {
      // A terminal emulator parses whatever a program nobody here controls prints; one sequence it
      // mishandles must cost the rendering of one chunk, never the session.
      try {
        term.write(bytes);
      } catch (e) {
        console.warn(`terminal: dropped a chunk the emulator could not parse: ${String(e)}`);
      }
    },
    setTyping: (on) => {
      typing = on;
      term.options.disableStdin = !on;
      if (on) term.focus();
      else term.blur();
    },
    fit: refit,
    dispose: () => {
      observer?.disconnect();
      el.removeEventListener("wheel", onWheel, { capture: true });
      el.removeEventListener("touchstart", onTouchStart, { capture: true });
      el.removeEventListener("touchmove", onTouchMove, { capture: true });
      term.dispose();
    },
  };
}
