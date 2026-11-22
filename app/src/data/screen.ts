/*
 * The wire to one live screen, and the loop that keeps it connected.
 *
 * Protocol (the backend's viewer socket, /mt/machine/screen/{sid}?token&cols&rows): the room the
 * view has goes with the dial, so the first paint is already at the size it will keep. Binary
 * frames are screen bytes in and input out (keys, pastes, mouse sequences: the wheel scrolls tmux).
 * Text frames out: {type:"resize",cols,rows}, {type:"ack",n} (bytes drawn; the machine sends more
 * only as these arrive), {type:"reply",data} (base64: the terminal's answers to tmux, outside the
 * lease), {type:"lease",op:"take"|"renew"|"release"}, {type:"capture",id}, {type:"command",id,name}.
 * Text frames in: {type:"size",cols,rows} (the terminal's size from now on, before any byte at that
 * size), {type:"lease",holder,name,refused}, {type:"capture",id,text,error},
 * {type:"command",id,error}, {type:"commands",names} (what the screen's driver offers),
 * {type:"error",error}.
 *
 * Input is under a lease, held by one party at a time. The first input on a free screen takes it,
 * and so does asking for it (take()); it is renewed every second while the person types (a key, or
 * the take, in the last minute) or scrolls (a wheel turn in the last few seconds), then given back;
 * leaving gives it back too. Input or a take while someone else holds it is refused by the machine,
 * and the state says who holds it for a few seconds. While a person holds it the agent's program
 * holds back what it is told to type. Each connection starts with the lease free and nothing drawn.
 *
 * LiveScreen({ open, path(cols, rows), onState, now? }) — path gives the address to dial, or null
 *   when there is nobody signed in (then nothing is dialled and the state says so).
 *   start() dials once the terminal has said its room (room(); a room under 20x5 is a view that is
 *   not there and is ignored), close() ends it for good, retry() redials now. drawOn(sink) says
 *   where the stream goes. input(data, typed?) sends input (typed false: a reply);
 *   rendered(n) reports drawn bytes; capture() resolves to the screen's text with its history;
 *   command(name) gives the lease back and asks the driver for "compact"; take() asks for the
 *   lease; release() gives it back. Reconnects forever, waiting LiveScreen.waitFor(attempt) — 0.5 s, doubling
 *   to 30 s — and forgiving the count only once a connection has lasted 5 s.
 *   onState(ScreenState) on every change.
 * ScreenState — connected, reconnecting, doubtful (three attempts failed without one opening: the
 *   screen may be gone, or not this person's to watch), drawn (this connection's first bytes are on
 *   the terminal), size (the terminal's) and resizes (how many times it changed after the first
 *   paint of this view), lease (who holds the input), refused (for a few seconds after the machine
 *   refused this person's input or take: who holds the input, as holderText says it, and whether
 *   what was refused was typed), error (what went wrong for this viewer), commands (the driver's).
 * Lease — { holder: "free" | "self" | "driver" | "other", name }.
 * holderText(lease) — who holds it, said for a person: "the agent is typing", "Ada is operating";
 *   null when it is free or this person's.
 * ScreenSink — what drawOn takes: write(bytes), size(cols, rows), reset() (each new connection
 *   starts on a clean terminal).
 * useLiveScreen(sessionId) → { state, screen } — a LiveScreen over the session's substrate for the
 *   calling component's lifetime, redialled when the app returns to the foreground and giving the
 *   lease back when it leaves it.
 *
 * Example: const { screen } = useLiveScreen(sid); screen.drawOn(term); screen.room(80, 24);
 */
import { useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";
import type { Wire } from "../transport/live/socket";
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
  refused: { holder: string; typed: boolean } | null;
  error: string | null;
  commands: string[];
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
/** A scroll holds the lease only this long after the last turn: typing holds it for IDLE_MS. */
const SCROLL_HOLD_MS = 3_000;
/** A smaller room is a view that is not really there (hidden, not laid out): it is not sent, so it
 * can never shrink the window for everybody. */
const MIN_COLS = 20;
const MIN_ROWS = 5;
/** Mouse sequences (SGR and X10): the wheel, which scrolls tmux. */
const MOUSE = /^\x1b\[(<|M)/;

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
  commands: [],
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
  private lastTyped = -Infinity;
  private lastScroll = -Infinity;
  /** What the last request for the lease was: typed input, or a take. */
  private lastAsk: "typed" | "take" = "typed";
  private dialedRoom = { cols: 0, rows: 0 };
  private written = 0;
  private acked = 0;
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
      path: (cols: number, rows: number) => string | null;
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
    if (this.refusedTimer) clearTimeout(this.refusedTimer);
    this.refusedTimer = null;
    this.failPending("the screen was closed");
    this.drop();
  }

  /** Dial again now: on return to the foreground, or when a person will not wait out the backoff. */
  retry() {
    this.attempt = 0;
    this.dial();
  }

  /** The room the view has, in cells. The first real one starts the dial; one below MIN_COLS x
   * MIN_ROWS is a view that is not there and is ignored. */
  room(cols: number, rows: number) {
    if (cols < MIN_COLS || rows < MIN_ROWS) {
      console.log(`screen: a ${cols}x${rows} room is not a real view; not sent`);
      return;
    }
    const first = this.roomSize.cols === 0;
    this.roomSize = { cols, rows };
    if (first) {
      if (this.started) this.dial();
    } else this.json({ type: "resize", cols, rows });
  }

  /**
   * Input for the machine. typed is false for the terminal's own answers to tmux, which go as
   * replies: they never take or keep the lease. Typing keeps the lease for a minute after the last
   * key; mouse input (the wheel) only for a few seconds after the last turn.
   */
  input(data: string | Uint8Array, typed = true) {
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    if (!typed) return this.json({ type: "reply", data: base64(bytes) });
    if (MOUSE.test(new TextDecoder().decode(bytes.subarray(0, 3)))) this.lastScroll = this.now();
    else this.lastTyped = this.now();
    this.lastAsk = "typed";
    this.send(bytes);
  }

  /** n more bytes of this connection's stream are drawn. An acknowledgement left over from an
   * earlier connection is not passed on: it counts no byte of this one. */
  rendered(n: number) {
    const count = Math.min(n, this.written - this.acked);
    if (count <= 0) return;
    this.acked += count;
    this.json({ type: "ack", n: count });
    if (!this.state.drawn) this.set({ drawn: true });
  }

  /** Ask for the lease without typing: it is then held as if the person had just typed. */
  take() {
    this.lastTyped = this.now();
    this.lastAsk = "take";
    this.json({ type: "lease", op: "take" });
  }

  /** Give the lease back now: the person has let go, or left (the app went to the background). */
  release() {
    if (this.state.lease.holder === "self") this.json({ type: "lease", op: "release" });
    this.lastTyped = this.lastScroll = -Infinity;
  }

  capture(): Promise<string> {
    return this.request({ type: "capture" });
  }

  /** Asking the driver to act hands it the input: the lease is given back first. */
  command(name: "compact"): Promise<string> {
    this.release();
    return this.request({ type: "command", name });
  }

  /** The wait before the attempt-th redial: 0.5 s for the first, doubling up to 30 s. */
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
    // Nothing of the last connection holds for the next: not that it is open, not who has the lease.
    this.written = this.acked = 0;
    this.set({ connected: false, drawn: false, lease: { holder: "free", name: null }, commands: [] });
    const path = this.opts.path(this.roomSize.cols, this.roomSize.rows);
    if (path === null) {
      this.set({ error: "signed out: sign in again to watch this screen" });
      return;
    }
    this.dialedRoom = { ...this.roomSize };
    const wire = this.opts.open(path);
    this.wire = wire;
    wire.onopen = () => {
      if (this.wire !== wire) return;
      this.everOpened = true;
      this.freshConnection = true;
      this.stableTimer = setTimeout(() => (this.attempt = 0), STABLE_AFTER);
      this.renewTimer = setInterval(() => this.renew(), RENEW_MS);
      this.set({ connected: true, reconnecting: false, drawn: false, error: null });
      // The room may have changed while the socket was opening; the dial carried the old one.
      const { cols, rows } = this.roomSize;
      if (cols !== this.dialedRoom.cols || rows !== this.dialedRoom.rows) this.json({ type: "resize", cols, rows });
    };
    wire.onmessage = ({ data }) => {
      if (this.wire !== wire) return;
      if (data instanceof ArrayBuffer) this.draw(new Uint8Array(data));
      else if (data instanceof Uint8Array) this.draw(data);
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

  private draw(bytes: Uint8Array) {
    this.written += bytes.length;
    this.sink.write(bytes);
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
        const holder = holderText(lease) ?? "someone else is operating";
        if (this.refusedTimer) clearTimeout(this.refusedTimer);
        this.refusedTimer = setTimeout(() => this.set({ refused: null }), REFUSED_MS);
        this.set({ lease, refused: { holder, typed: this.lastAsk === "typed" } });
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
    } else if (m.type === "commands") {
      this.set({ commands: (m.names as string[]) ?? [] });
    }
  }

  private renew() {
    if (this.state.lease.holder !== "self") return;
    const now = this.now();
    const active = now - this.lastTyped < IDLE_MS || now - this.lastScroll < SCROLL_HOLD_MS;
    this.json({ type: "lease", op: active ? "renew" : "release" });
  }

  private drop() {
    const w = this.wire;
    this.wire = null;
    if (w) {
      w.onclose = w.onerror = w.onmessage = w.onopen = null;
      w.close();
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
    this.wire.send(data);
  }

  private set(change: Partial<ScreenState>) {
    this.state = { ...this.state, ...change };
    this.opts.onState?.(this.state);
  }
}

export function holderText(lease: Lease): string | null {
  if (lease.holder === "driver") return "the agent is typing";
  if (lease.holder === "other") return `${lease.name ?? "someone"} is operating`;
  return null;
}

function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
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
        path: (cols, rows) => {
          const t = token();
          return t ? `/mt/machine/screen/${encodeURIComponent(sessionId)}?token=${encodeURIComponent(t)}&cols=${cols}&rows=${rows}` : null;
        },
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
