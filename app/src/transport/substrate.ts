/*
 * The substrate: one redundant MultiPath stream to the origin, carried over every line the
 * deployment publishes, with each HTTP exchange and each WebSocket a stream on top of it.
 *
 * new Substrate(origin) — starts dialling at once over the origin and every line it saved last
 *   time, so the first request of a session can already ride the fastest line, whatever it is.
 * substrate.adopt(lines) — the deployment's current lines (/mt/lines): new ones join the running
 *   client — a dial still in progress included — and the union is saved for next time. A line
 *   already up is never dropped to learn about another.
 * substrate.fetch(input, init) — fetch() over the substrate. It goes out directly instead when the
 *   substrate cannot carry it now: no line has come up within DIAL_WAIT of the dial, or none is up
 *   at this moment; and a GET or HEAD that the substrate fails, or does not start answering within
 *   REQUEST_WAIT (a line that died silently is only noticed after a while, and a request over it
 *   would hang until then), is sent again directly.
 * substrate.openSocket(path) → Wire — a WebSocket to the origin: a stream over the substrate once a
 *   line is up, waiting at most DIAL_WAIT for one, and directly otherwise, or when the stream is not
 *   open within REQUEST_WAIT; the updates socket's and the live screen's open().
 * substrate.stats() — each line's health, for the lines panel; error() — the last failure;
 *   linesInUse() — the lines the client is using.
 * substrate.reset() — close the client and dial again (the app came back from the background, and
 *   links held across it may be silently dead).
 *
 * Example: const s = new Substrate(origin); const res = await s.fetch(`${origin}/mt/chat`);
 *
 * Everything the app fetches goes through here except two kinds, each for a reason: the calls to
 * cheese-auth (api/auth.ts) — signing in rides the httpOnly refresh cookie, which a browser attaches
 * only to its own requests, never to bytes a script sends over another transport, and a picture is
 * posted as the platform's own file upload — and an installer download (one large file for the
 * system to fetch). The page's own files ride the lines through the service worker (worker/sw.ts).
 */
import { Client, type LinkStat } from "@micro-teams/multipath";
import { storage } from "../platform/storage";
import type { Wire } from "./updates/socket";

const SERVICE = "app";
/** How long after a dial starts requests wait for its first line before going out directly. */
const DIAL_WAIT = 3000;
/** How long a GET waits for the substrate's answer to start, or a socket for its stream to open,
 * before going directly. A line that answers at all answers well within it. */
const REQUEST_WAIT = 2500;
/**
 * How quickly a dead line is noticed and replaced. A phone changing networks leaves its sockets
 * open and silent; the client's defaults (a ping every 5 s, dead after 15 s, retries backing off to
 * 5 s) would leave everything on that line stalled for most of a quarter of a minute, and the line
 * that does come back up up to 5 s after the network has. A ping is a few bytes; a line that stays
 * unreachable costs one attempt every 2 s.
 */
const LIVENESS = { pingIntervalMs: 2000, deadAfterMs: 5000, maxDelayMs: 2000 };

const lineKey = (origin: string) => `lines:${origin}`;
const asWebSocket = (url: string) => url.replace(/^http/, "ws");

function within<T>(p: Promise<T>, ms: number): Promise<T | "late"> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve("late"), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e: unknown) => (clearTimeout(t), reject(e)),
    );
  });
}

type Inner = { send(d: string | Uint8Array): void; close(): void; binaryType?: string } & Omit<Wire, "send" | "close">;

export class Substrate {
  private lines: string[];
  private client: Client | null = null;
  private dialledAt = 0;
  private lastError: string | null = null;

  constructor(private readonly origin: string) {
    const saved = storage.getJson<string[]>(lineKey(origin)) ?? [];
    this.lines = [...new Set([origin, ...saved])];
    this.live();
  }

  adopt(lines: string[]) {
    const fresh = lines.filter((l) => !this.lines.includes(l));
    if (!fresh.length) return;
    this.lines = [...this.lines, ...fresh];
    storage.setJson(lineKey(this.origin), this.lines);
    const added = this.client && !this.client.closed ? this.client.addLines(fresh.map(asWebSocket)) : 0;
    if (added) console.log(`multipath: added ${fresh.join(", ")}`);
  }

  /** The running client, dialling a new one if there is none or the origin refused the last. */
  private live(): Client {
    if (!this.client || this.client.closed) {
      this.client = Client.connect(this.lines.map(asWebSocket), LIVENESS);
      this.dialledAt = Date.now();
      const client = this.client;
      void client.ready().then(() => {
        if (client.closed) return;
        this.lastError = null;
        console.log(`multipath: substrate up over ${this.lines.join(", ")}`);
      });
    }
    return this.client;
  }

  private up(client: Client): boolean {
    return !client.closed && client.stats().some((s) => s.state === "up");
  }

  /** Waits for the client's first line, but no longer than what is left of DIAL_WAIT. */
  private async ready(client: Client): Promise<boolean> {
    if (this.up(client)) return true;
    const left = Math.max(0, DIAL_WAIT - (Date.now() - this.dialledAt));
    return (await within(client.ready(), left)) !== "late" && this.up(client);
  }

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const client = this.live();
    const request = input instanceof Request && !init ? input : new Request(input, init);
    const retryable = request.method === "GET" || request.method === "HEAD";
    if (!(await this.ready(client))) return globalThis.fetch(request);
    const started = Date.now();
    try {
      if (!retryable) return await client.fetch(SERVICE, request);
      const answer = await within(client.fetch(SERVICE, request.clone()), REQUEST_WAIT);
      if (answer !== "late") return answer;
      this.lastError = `${request.method} ${request.url}: no answer over the lines in ${REQUEST_WAIT} ms`;
    } catch (e) {
      this.lastError = `${request.method} ${request.url}: ${String(e)}`;
      if (!retryable) throw e;
    }
    console.warn(`multipath: ${this.lastError} (after ${Date.now() - started} ms), asking directly`);
    return globalThis.fetch(request);
  };

  openSocket = (path: string): Wire => {
    let inner: Inner | null = null;
    let dropped = false;
    const wire: Wire = {
      send: (data) => {
        if (!inner) throw new Error("socket not open yet");
        inner.send(data);
      },
      close: () => {
        dropped = true;
        inner?.close();
      },
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
    };
    const attach = (ws: Inner, opened: boolean) => {
      if (dropped) return ws.close();
      inner = ws;
      ws.onmessage = (ev) => wire.onmessage?.(ev);
      ws.onclose = () => wire.onclose?.();
      ws.onerror = (e) => wire.onerror?.(e);
      if (opened) wire.onopen?.();
      else ws.onopen = () => wire.onopen?.();
    };
    const direct = (why: string) => {
      console.warn(`multipath: ${why}, opening ${path.split("?")[0]} directly`);
      const ws = new WebSocket(asWebSocket(this.origin) + path);
      ws.binaryType = "arraybuffer"; // binary frames as bytes, as they arrive over the substrate
      attach(ws as unknown as Inner, false);
    };
    const client = this.live();
    void this.ready(client).then(async (ok) => {
      if (!ok) return direct("no line up");
      let late = false;
      const timer = setTimeout(() => {
        late = true;
        this.lastError = `socket ${path.split("?")[0]}: not open over the lines in ${REQUEST_WAIT} ms`;
        direct(`not open over the lines in ${REQUEST_WAIT} ms`);
      }, REQUEST_WAIT);
      try {
        const ws = (await client.openWebSocket(SERVICE, path)) as unknown as Inner;
        clearTimeout(timer);
        if (late) return ws.close();
        attach(ws, true);
      } catch (e) {
        clearTimeout(timer);
        if (late) return;
        this.lastError = `socket ${path.split("?")[0]}: ${String(e)}`;
        wire.onerror?.(e);
      }
    });
    return wire;
  };

  stats(): LinkStat[] {
    return this.client?.stats() ?? [];
  }

  error(): string | null {
    return this.lastError;
  }

  linesInUse(): string[] {
    return this.lines;
  }

  reset() {
    this.client?.close();
    this.client = null;
    this.live();
  }
}
