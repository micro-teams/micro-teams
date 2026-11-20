/*
 * The wire to one live screen, and the loop that keeps it connected.
 *
 * Protocol (the backend's viewer socket, /mt/machine/screen/{sid}?token&cols&rows): the room the
 * view has goes with the dial, so the first paint is already at the size it will keep. Binary
 * frames are screen bytes in and input out (keys, pastes, mouse sequences: the wheel scrolls tmux).
 * Text frames out: {type:"resize",cols,rows}, {type:"ack",n} (bytes drawn; the machine sends more
 * only as these arrive), {type:"lease",op:"renew"|"release"}, {type:"capture",id},
 * {type:"command",id,name}. Text frames in: {type:"size",cols,rows} (the terminal's size from now
 * on, before any byte at that size), {type:"lease",holder,name,refused}, {type:"capture",id,text,
 * error}, {type:"command",id,error}, {type:"error",error}.
 *
 * Input is under a lease, held by one party at a time. The first input on a free screen takes it;
 * while the person keeps using it (input in the last minute) it is renewed every second, then given
 * back; closing gives it back too. Input while someone else holds it is refused by the machine, and
 * the state says so for a few seconds.
 *
 * LiveScreen({ open, path(cols, rows), onState, now? }) — start() dials once the terminal has said its room (room()),
 *   close() ends it for good, retry() redials now. drawOn(sink) says where the stream goes: the
 *   sink's write(bytes), size(cols, rows) and reset() (each new connection starts on a clean
 *   terminal). input(data) sends input; rendered(n) reports drawn bytes; capture() resolves to the
 *   screen's text with its history; command(name) gives the lease back and asks the driver for
 *   "usage" or "compact"; release() gives the lease back.
 *   Reconnects forever: 0.5 s, doubling to 30 s, forgiven only once a connection has lasted 5 s.
 *   onState(ScreenState) on every change.
 * ScreenState — connected, reconnecting, doubtful (three attempts failed without one opening: the
 *   screen may be gone, or not this person's to watch), drawn (this connection's first bytes are on
 *   the terminal), size (the terminal's) and resizes (how many times it changed after the first
 *   paint of this view), lease (who holds the input), refused (who refused this person's input,
 *   for a few seconds), error (what the machine last said went wrong for this viewer).
 * Lease — { holder: "free" | "self" | "driver" | "other", name }.
 * ScreenSink — what drawOn takes: write(bytes), size(cols, rows), reset().
 * useLiveScreen(sessionId) → { state, screen } — a LiveScreen over the session's substrate for the
 *   calling component's lifetime, redialled when the app returns to the foreground and giving the
 *   lease back when it leaves it.
 *
 * Example: const { screen } = useLiveScreen(sid); screen.drawOn(term); screen.room(80, 24);
 */
import { useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";
import type { Wire } from "../transport/updates/socket";
import { useSession } from "./session";

export type Lease = { holder: "free" | "self" | "driver" | "other"; name: string | null };
export type ScreenState = {
  connected: boolean;
  reconnecting: boolean;
  doubtful: boolean;
  drawn: boolean;
  size: { cols: number; rows: number } | null;
  resizes: number;
  lease: Lease;
  refused: string | null;
  error: string | null;
};
export interface ScreenSink {
  write(bytes: Uint8Array): void;
  size(cols: number, rows: number): void;
  reset(): void;
}

const FIRST_WAIT = 500;
const MAX_WAIT = 30_000;
const STABLE_AFTER = 5_000;
const RENEW_MS = 1_000;
const IDLE_MS = 60_000;
const REFUSED_MS = 3_000;
const REPLY_MS = 15_000;

const INITIAL: ScreenState = {
  connected: false,
  reconnecting: false,
  doubtful: false,
  drawn: false,
  size: null,
  resizes: 0,
  lease: { holder: "free", name: null },
  refused: null,
  error: null,
};

type Pending = { resolve: (v: string) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

export class LiveScreen {
  private wire: Wire | null = null;
  private roomSize = { cols: 0, rows: 0 };
  private started = false;
  private attempt = 0;
  private everOpened = false;
  private freshConnection = false;
  private firstPaint = true;
  private lastInput = 0;
  private seq = 0;
  private pending = new Map<string, Pending>();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private stableTimer: ReturnType<typeof setTimeout> | null = null;
  private renewTimer: ReturnType<typeof setInterval> | null = null;
  private refusedTimer: ReturnType<typeof setTimeout> | null = null;
  private sink: ScreenSink = { write: () => {}, size: () => {}, reset: () => {} };
  private state: ScreenState = INITIAL;

  constructor(
    private readonly opts: {
      open: (path: string) => Wire;
      path: (cols: number, rows: number) => string;
      onState?: (s: ScreenState) => void;
      now?: () => number;
    },
  ) {}

  /** Where the stream goes; replaceable, so the drawing side can change without a redial. */
  drawOn(sink: ScreenSink) {
    this.sink = sink;
  }

  start() {
    this.started = true;
    if (this.roomSize.cols > 0) this.dial();
  }

  close() {
    this.started = false;
    this.clearTimers();
    this.failPending("the screen was closed");
    this.drop();
  }

  /** Dial again now: on return to the foreground, or when a person will not wait out the backoff. */
  retry() {
    this.attempt = 0;
    this.dial();
  }

  /** The room the view has, in cells. The first one starts the dial. */
  room(cols: number, rows: number) {
    const first = this.roomSize.cols === 0;
    this.roomSize = { cols, rows };
    if (first) {
      if (this.started) this.dial();
    } else this.json({ type: "resize", cols, rows });
  }

  input(data: string | Uint8Array) {
    this.lastInput = this.now();
    this.send(typeof data === "string" ? new TextEncoder().encode(data) : data);
  }

  rendered(n: number) {
    this.json({ type: "ack", n });
    if (!this.state.drawn) this.set({ drawn: true });
  }

  /** Give the lease back now: the person has left (the app went to the background). */
  release() {
    if (this.state.lease.holder === "self") this.json({ type: "lease", op: "release" });
    this.lastInput = 0;
  }

  capture(): Promise<string> {
    return this.request({ type: "capture" });
  }

  /** Asking the driver to act hands it the input: the lease is given back first. */
  command(name: "usage" | "compact"): Promise<string> {
    this.release();
    return this.request({ type: "command", name });
  }

  /** The wait before the next attempt: 0.5 s for the first retry, doubling to 30 s. */
  static waitFor(attempt: number): number {
    return Math.min(MAX_WAIT, FIRST_WAIT * 2 ** Math.max(0, attempt - 1));
  }

  private now() {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  private request(frame: Record<string, unknown>): Promise<string> {
    const id = `r${++this.seq}`;
    return new Promise((resolve, reject) => {
      if (!this.state.connected) return reject(new Error("not connected"));
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("no answer from the machine"));
      }, REPLY_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.json({ ...frame, id });
    });
  }

  private failPending(why: string) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error(why));
    }
    this.pending.clear();
  }

  private dial() {
    if (!this.started || this.roomSize.cols === 0) return;
    this.clearTimers();
    this.drop();
    const wire = this.opts.open(this.opts.path(this.roomSize.cols, this.roomSize.rows));
    this.wire = wire;
    wire.onopen = () => {
      if (this.wire !== wire) return;
      this.everOpened = true;
      this.freshConnection = true;
      this.stableTimer = setTimeout(() => (this.attempt = 0), STABLE_AFTER);
      this.renewTimer = setInterval(() => this.renew(), RENEW_MS);
      this.set({ connected: true, reconnecting: false, drawn: false, error: null });
    };
    wire.onmessage = ({ data }) => {
      if (this.wire !== wire) return;
      if (data instanceof ArrayBuffer) this.sink.write(new Uint8Array(data));
      else if (data instanceof Uint8Array) this.sink.write(data);
      else if (typeof data === "string") this.onText(data);
    };
    const lost = () => {
      if (this.wire !== wire || !this.started) return;
      this.wire = null;
      this.clearTimers();
      this.failPending("the connection was lost");
      this.attempt += 1;
      this.retryTimer = setTimeout(() => this.dial(), LiveScreen.waitFor(this.attempt));
      this.set({
        connected: false,
        reconnecting: true,
        doubtful: !this.everOpened && this.attempt > 2,
        lease: { holder: "free", name: null },
      });
    };
    wire.onclose = lost;
    wire.onerror = lost;
  }

  private onText(text: string) {
    const m = JSON.parse(text) as Record<string, unknown>;
    if (m.type === "size") {
      const cols = Number(m.cols);
      const rows = Number(m.rows);
      if (this.freshConnection) this.sink.reset();
      this.freshConnection = false;
      this.sink.size(cols, rows);
      const prev = this.state.size;
      const changed = !prev || prev.cols !== cols || prev.rows !== rows;
      const resizes = this.state.resizes + (changed && !this.firstPaint ? 1 : 0);
      this.firstPaint = false;
      this.set({ size: { cols, rows }, resizes });
    } else if (m.type === "lease") {
      const lease: Lease = { holder: m.holder as Lease["holder"], name: (m.name as string | null) ?? null };
      if (m.refused) {
        const who = lease.holder === "driver" ? "the agent" : lease.name ?? "someone else";
        if (this.refusedTimer) clearTimeout(this.refusedTimer);
        this.refusedTimer = setTimeout(() => this.set({ refused: null }), REFUSED_MS);
        this.set({ lease, refused: who });
      } else this.set({ lease });
    } else if (m.type === "capture" || m.type === "command") {
      const p = this.pending.get(String(m.id));
      if (!p) return;
      this.pending.delete(String(m.id));
      clearTimeout(p.timer);
      if (m.error) p.reject(new Error(String(m.error)));
      else p.resolve(String(m.text ?? ""));
    } else if (m.type === "error") {
      this.set({ error: String(m.error) });
    }
  }

  private renew() {
    if (this.state.lease.holder !== "self") return;
    if (this.now() - this.lastInput < IDLE_MS) this.json({ type: "lease", op: "renew" });
    else this.json({ type: "lease", op: "release" });
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
    for (const t of [this.retryTimer, this.stableTimer]) if (t) clearTimeout(t);
    if (this.renewTimer) clearInterval(this.renewTimer);
    this.retryTimer = this.stableTimer = this.renewTimer = null;
  }

  private json(frame: Record<string, unknown>) {
    this.send(JSON.stringify(frame));
  }

  private send(data: string | Uint8Array) {
    // Nothing is queued while down: a new connection starts from the room and a fresh paint.
    if (!this.state.connected || !this.wire) return;
    try {
      this.wire.send(data);
    } catch {
      // dropped while closing
    }
  }

  private set(change: Partial<ScreenState>) {
    this.state = { ...this.state, ...change };
    this.opts.onState?.(this.state);
  }
}

export function useLiveScreen(sessionId: string) {
  const { substrate, token } = useSession();
  const [state, setState] = useState<ScreenState>(INITIAL);
  const screen = useMemo(
    () =>
      new LiveScreen({
        open: substrate.openSocket,
        // Read per dial: a reconnect with an expired token is refused, and a refusal looks exactly
        // like a machine that has gone quiet.
        path: (cols, rows) =>
          `/mt/machine/screen/${encodeURIComponent(sessionId)}?token=${encodeURIComponent(token() ?? "")}&cols=${cols}&rows=${rows}`,
        onState: setState,
      }),
    [substrate, token, sessionId],
  );
  useEffect(() => {
    screen.start();
    const sub = AppState.addEventListener("change", (s) => (s === "active" ? screen.retry() : screen.release()));
    return () => {
      sub.remove();
      screen.close();
    };
  }, [screen]);
  return { state, screen };
}
