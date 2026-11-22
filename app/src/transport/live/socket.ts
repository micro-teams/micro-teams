/*
 * The one live socket, and the loop that keeps it up.
 *
 * new LiveSocket({ path, open, onOpen, onFrame }) — path() is read on every dial, so a reconnect
 *   after a token refresh carries the new token. open(path) is how a socket is made (over the
 *   substrate, or directly); it is injected so the reconnect rules can be driven without a server.
 *   onOpen(send) runs on every connection, with the way to send frames on it; onFrame(text) gets
 *   every text frame the server sends.
 * socket.start() — dial, and keep dialling with a widening gap (1 s doubling to 20 s, forgiven
 *   once a connection has lasted 5 s).
 * socket.resumed() — the app came back to the foreground: dial again at once, because a suspended
 *   process cannot know whether its socket survived.
 * socket.close() — for good.
 * Wire — the WebSocket shape open() returns: send, close, and the four on* callbacks.
 *
 * Example:
 *   const s = new LiveSocket({ path: () => `/mt/live?token=${t}`, open: (p) => new WebSocket(url + p),
 *     onOpen: (send) => send('{"t":"get","id":"a","path":"/chat"}'), onFrame: (f) => handle(f) });
 *   s.start();
 *
 * The heartbeat is for one failure only: a half-open socket that never reports closing. A ping
 * every 20 s, and a socket silent for 45 s is closed and dialled again.
 */

export interface Wire {
  send(data: string | Uint8Array): void;
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

export type LiveSocketOptions = {
  path: () => string;
  open: (path: string) => Wire;
  onOpen: (send: (text: string) => void) => void;
  onFrame: (text: string) => void;
};

export class LiveSocket {
  private wire: Wire | null = null;
  private closed = true;
  private backoff = MIN_RETRY_MS;
  private lastHeard = 0;
  private ping: ReturnType<typeof setInterval> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private stable: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly opts: LiveSocketOptions) {}

  start() {
    this.closed = false;
    this.dial();
    this.ping = setInterval(() => this.heartbeat(), PING_MS);
  }

  resumed() {
    if (this.closed) return;
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
      console.warn(`live: could not open the socket: ${String(e)}`);
      this.lost();
      return;
    }
    this.wire = wire;
    this.lastHeard = Date.now();
    wire.onopen = () => {
      if (this.wire !== wire) return;
      this.opts.onOpen((text) => {
        if (this.wire === wire) wire.send(text);
      });
      this.stable = setTimeout(() => {
        if (this.wire === wire) this.backoff = MIN_RETRY_MS;
      }, STABLE_MS);
    };
    wire.onmessage = (ev) => {
      this.lastHeard = Date.now();
      if (typeof ev.data === "string") this.opts.onFrame(ev.data);
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
      wire.send(JSON.stringify({ t: "ping" }));
    } catch {
      this.lost();
    }
  }
}
