/*
 * The wire to one live screen, and the loop that keeps it connected.
 *
 * Protocol (the connector's, unchanged): binary frames are screen bytes in and keystrokes out;
 *   {"type":"control","level":"passive"|"scroll"|"full"} says what the human is doing, so the driver
 *   knows when the screen is trustworthy to sample; {"type":"resize","cols","rows"} keeps the real
 *   pty the size we draw; {"type":"scroll","dir":"up"|"down"|"bottom"} drives tmux copy-mode,
 *   because the program on the screen keeps no scrollback of its own; {"type":"compact"} asks the
 *   driver to compact. A text frame from the server is not part of it and is ignored.
 *
 * LiveScreen({ open, path, onState }) — start() dials; close() ends it for good; drawOn(f) says
 *   where screen bytes go. Modes:
 *   "watching" never types (keys() is dropped: that promise is what lets an agent keep working
 *   while people watch; escape() is the one key sent in any mode, because it has a button of its
 *   own), "history" pages back through tmux, "typing" has the keyboard. setMode
 *   leaving history returns the pane to the live screen for everybody. scroll(dir) may be sent in
 *   any mode and holds the driver off ("scroll") until two seconds after the last step.
 *   Reconnects forever: 0.5 s, doubling to 30 s, forgiven only once a connection has lasted 5 s,
 *   so a line that accepts and drops at once is not dialled in a tight loop. retry() skips the
 *   wait. onState({ mode, connected, reconnecting, doubtful }) — doubtful once three attempts have
 *   failed without one ever opening: the screen may be gone, or not this person's to watch.
 * useLiveScreen(sessionId, onBytes) → { state, screen } — a LiveScreen over the session's substrate
 *   for the calling component's lifetime, redialled when the app returns to the foreground.
 *
 * Example: const { screen } = useLiveScreen(sid, (b) => term.write(b)); screen.setMode("typing");
 */
import { useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";
import type { Wire } from "../transport/updates/socket";
import { useSession } from "./session";

export type ViewMode = "watching" | "history" | "typing";
export type ScrollDir = "up" | "down" | "bottom";
export type ScreenState = { mode: ViewMode; connected: boolean; reconnecting: boolean; doubtful: boolean };

const LEVEL: Record<ViewMode, string> = { watching: "passive", history: "scroll", typing: "full" };
const FIRST_WAIT = 500;
const MAX_WAIT = 30_000;
const STABLE_AFTER = 5_000;
const SCROLL_IDLE = 2_000;

export class LiveScreen {
  private wire: Wire | null = null;
  private mode: ViewMode = "watching";
  private size = { cols: 0, rows: 0 };
  private attempt = 0;
  private everOpened = false;
  private connected = false;
  private reconnecting = false;
  private closed = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private stableTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly opts: {
      open: (path: string) => Wire;
      path: () => string;
      onState?: (s: ScreenState) => void;
    },
  ) {}

  private onBytes: (bytes: Uint8Array) => void = () => {};

  /** Where screen bytes go; replaceable, so the drawing side can change without a redial. */
  drawOn(onBytes: (bytes: Uint8Array) => void) {
    this.onBytes = onBytes;
  }

  start() {
    this.closed = false;
    this.dial();
  }

  close() {
    this.closed = true;
    this.clearTimers();
    this.drop();
  }

  /** Dial again now: on return to the foreground, or when a person will not wait out the backoff. */
  retry() {
    this.attempt = 0;
    this.dial();
  }

  keys(data: string) {
    if (this.mode !== "typing") return;
    this.send(new TextEncoder().encode(data));
  }

  /** Esc, from its own button: a deliberate press, sent in any mode. */
  escape() {
    this.send(new Uint8Array([0x1b]));
  }

  setMode(mode: ViewMode) {
    this.mode = mode;
    if (mode !== "history") this.json({ type: "scroll", dir: "bottom" });
    this.sendSize();
    this.json({ type: "control", level: LEVEL[mode] });
    this.report();
  }

  resize(cols: number, rows: number) {
    this.size = { cols, rows };
    this.sendSize();
  }

  scroll(dir: ScrollDir) {
    this.json({ type: "scroll", dir });
    if (dir === "bottom") return;
    this.json({ type: "control", level: LEVEL.history });
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.json({ type: "control", level: LEVEL[this.mode] }), SCROLL_IDLE);
  }

  compact() {
    this.json({ type: "compact" });
  }

  /** The wait before the next attempt: 0.5 s for the first retry, doubling to 30 s. */
  static waitFor(attempt: number): number {
    return Math.min(MAX_WAIT, FIRST_WAIT * 2 ** Math.max(0, attempt - 1));
  }

  private dial() {
    if (this.closed) return;
    this.clearTimers();
    this.drop();
    const wire = this.opts.open(this.opts.path());
    this.wire = wire;
    wire.onopen = () => {
      if (this.wire !== wire) return;
      this.everOpened = true;
      this.connected = true;
      this.reconnecting = false;
      // Say what we are the moment we arrive, rather than leaving the driver to assume.
      this.sendSize();
      this.json({ type: "control", level: LEVEL[this.mode] });
      this.stableTimer = setTimeout(() => (this.attempt = 0), STABLE_AFTER);
      this.report();
    };
    wire.onmessage = ({ data }) => {
      if (this.wire !== wire) return;
      if (data instanceof ArrayBuffer) this.onBytes(new Uint8Array(data));
      else if (data instanceof Uint8Array) this.onBytes(data);
    };
    const lost = () => {
      if (this.wire !== wire || this.closed) return;
      this.wire = null;
      this.connected = false;
      this.reconnecting = true;
      if (this.stableTimer) clearTimeout(this.stableTimer);
      this.attempt += 1;
      this.retryTimer = setTimeout(() => this.dial(), LiveScreen.waitFor(this.attempt));
      this.report();
    };
    wire.onclose = lost;
    wire.onerror = lost;
  }

  private drop() {
    const w = this.wire;
    this.wire = null;
    if (w) {
      w.onclose = w.onerror = w.onmessage = w.onopen = null;
      try {
        w.close();
      } catch {
        // already closing
      }
    }
  }

  private clearTimers() {
    for (const t of [this.retryTimer, this.stableTimer, this.idleTimer]) if (t) clearTimeout(t);
    this.retryTimer = this.stableTimer = this.idleTimer = null;
  }

  private sendSize() {
    if (this.size.cols > 0 && this.size.rows > 0) this.json({ type: "resize", ...this.size });
  }

  private json(frame: Record<string, unknown>) {
    this.send(JSON.stringify(frame));
  }

  private send(data: string | Uint8Array) {
    if (!this.connected || !this.wire) return; // everything said here is said again on the next open
    try {
      this.wire.send(data);
    } catch {
      // dropped while closing
    }
  }

  private report() {
    this.opts.onState?.({
      mode: this.mode,
      connected: this.connected,
      reconnecting: this.reconnecting,
      doubtful: !this.everOpened && this.attempt > 2,
    });
  }
}

export function useLiveScreen(sessionId: string, onBytes: (bytes: Uint8Array) => void) {
  const { substrate, token } = useSession();
  const [state, setState] = useState<ScreenState>({ mode: "watching", connected: false, reconnecting: false, doubtful: false });
  const screen = useMemo(
    () =>
      new LiveScreen({
        open: substrate.openSocket,
        // Read per dial: a reconnect with an expired token is refused, and a refusal looks exactly
        // like a machine that has gone quiet.
        path: () => `/mt/machine/screen/${encodeURIComponent(sessionId)}?token=${encodeURIComponent(token() ?? "")}`,
        onState: setState,
      }),
    [substrate, token, sessionId],
  );
  useEffect(() => {
    screen.drawOn(onBytes);
  });
  useEffect(() => {
    screen.start();
    const sub = AppState.addEventListener("change", (s) => s === "active" && screen.retry());
    return () => {
      sub.remove();
      screen.close();
    };
  }, [screen]);
  return { state, screen };
}
