/*
 * The one updates socket, and the loop that keeps it up.
 *
 * new UpdatesSocket({ store, path, open }) — path() is read on every dial, so a reconnect after a
 *   token refresh carries the new token. open(path) is how a socket is made (over the substrate, or
 *   directly); it is injected so the reconnect rules can be driven without a server.
 * socket.start() — dial, and keep dialling with a widening gap (1 s doubling to 20 s, forgiven
 *   once a connection has lasted 5 s).
 * socket.resumed() — the app came back to the foreground: every topic refetches once and the
 *   socket is dialled again at once, because a suspended process cannot know whether its socket
 *   survived.
 * socket.close() — for good.
 * Wire — the WebSocket shape open() returns: send, close, and the four on* callbacks.
 *
 * Example:
 *   const s = new UpdatesSocket({ store, path: () => `/mt/updates?token=${t}`, open: (p) => new WebSocket(url + p) });
 *   s.start();
 *
 * The heartbeat is for one failure only: a half-open socket that never reports closing. A ping
 * every 20 s, and a socket silent for 45 s is closed and dialled again.
 */
import { encodeFrame, parseFrame } from "./protocol";
import { UpdatesStore } from "./store";

export interface Wire {
  send(text: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: ((err: unknown) => void) | null;
}

const SILENCE_MS = 45_000;
const PING_MS = 20_000;
const MIN_RETRY_MS = 1_000;
const MAX_RETRY_MS = 20_000;
const STABLE_MS = 5_000;

export class UpdatesSocket {
  private wire: Wire | null = null;
  private closed = true;
  private backoff = MIN_RETRY_MS;
  private lastHeard = 0;
  private ping: ReturnType<typeof setInterval> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private stable: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly opts: { store: UpdatesStore; path: () => string; open: (path: string) => Wire },
  ) {}

  start() {
    this.closed = false;
    this.dial();
    this.ping = setInterval(() => this.heartbeat(), PING_MS);
  }

  resumed() {
    if (this.closed) return;
    this.opts.store.refocused();
    this.drop();
    this.dial();
  }

  close() {
    this.closed = true;
    if (this.ping) clearInterval(this.ping);
    this.drop();
  }

  private drop() {
    if (this.retry) clearTimeout(this.retry);
    if (this.stable) clearTimeout(this.stable);
    const old = this.wire;
    this.wire = null;
    this.opts.store.disconnected();
    if (old) {
      old.onclose = old.onmessage = old.onerror = old.onopen = null;
      old.close();
    }
  }

  private dial() {
    if (this.closed) return;
    let wire: Wire;
    try {
      wire = this.opts.open(this.opts.path());
    } catch (e) {
      console.warn(`updates: could not open the socket: ${String(e)}`);
      this.lost();
      return;
    }
    this.wire = wire;
    this.lastHeard = Date.now();
    wire.onopen = () => {
      if (this.wire !== wire) return;
      this.opts.store.connected((frame) => wire.send(encodeFrame(frame)));
      this.stable = setTimeout(() => {
        if (this.wire === wire) this.backoff = MIN_RETRY_MS;
      }, STABLE_MS);
    };
    wire.onmessage = (ev) => {
      this.lastHeard = Date.now();
      if (typeof ev.data !== "string") return;
      const frame = parseFrame(ev.data);
      if (frame) this.opts.store.handle(frame);
    };
    wire.onclose = () => {
      if (this.wire === wire) this.lost();
    };
    wire.onerror = () => {
      if (this.wire === wire) this.lost();
    };
  }

  private lost() {
    if (this.closed) return;
    this.drop();
    this.retry = setTimeout(() => this.dial(), this.backoff);
    this.backoff = Math.min(this.backoff * 2, MAX_RETRY_MS);
  }

  private heartbeat() {
    const wire = this.wire;
    if (this.closed || !wire) return;
    if (Date.now() - this.lastHeard > SILENCE_MS) {
      this.lost();
      return;
    }
    try {
      wire.send(encodeFrame({ t: "ping" }));
    } catch {
      this.lost();
    }
  }
}
