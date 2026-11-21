/*
 * The substrate: one MultiPath session (protocol 3) to the server, carried over every line the
 * deployment publishes, with each HTTP exchange and each WebSocket a stream of it.
 *
 * new Substrate(origin, dial) — starts the client at once when dial is true, otherwise on start()
 *   or the first request. The line list comes from the origin (/multipath/v3/lines) and replaces
 *   the one kept from last time (stored with the origin that served it), which is dialled while
 *   the fresh one is fetched, so a slow or unreachable origin delays nothing when a line works. On
 *   React Native each answer is read whole and none is compressed: the platform has neither a
 *   streaming Response nor DecompressionStream.
 * substrate.start() — starts the client if it has not started; for a server somebody just chose.
 * substrate.fetch(input, init) — fetch() over the lines. It goes to the network instead, logged
 *   with the reason and counted, when no session is live (waiting for one at most FALLBACK_AFTER
 *   after the start, and again whenever a session ended less than REPLACING ago, since its
 *   successor is then usually seconds away: a server restart), and for a GET or HEAD also when the
 *   lines fail it or have not begun to answer within REQUEST_WAIT. Any other method is sent at most
 *   once, over the lines: once it may have reached the server, its failure is the caller's.
 * substrate.openSocket(path) → Wire — a WebSocket to the origin over a fresh stream, the updates
 *   socket's and the live screen's open(); directly, logged and counted, when no session is live
 *   (waiting for one as fetch does: at most FALLBACK_AFTER after the start, or while a session is
 *   being replaced) or the stream has not opened within REQUEST_WAIT.
 * substrate.diagnostics() → Diagnostics — everything the lines panel shows and copies: the client's
 *   stats (session, every line, every stream), the fallbacks with their reasons, and the latest
 *   events (lines up and down, sessions started and ended).
 * substrate.close() — says goodbye to the server, if the client started; for a Connection being
 *   replaced.
 *
 * Example: const s = new Substrate(origin, true); const res = await s.fetch(`${origin}/mt/chat`);
 *
 * Everything the app fetches goes through here except two kinds, each for a reason: the calls to
 * cheese-auth (api/auth.ts) — signing in rides the httpOnly refresh cookie, which a browser attaches
 * only to its own requests, never to bytes a script sends over another transport, and a picture is
 * posted as the platform's own file upload — and an installer download (one large file for the
 * system to fetch). The page's own files ride the lines through the service worker (worker/sw.ts).
 */
import { Client, createLineRouter, type ClientEvent, type ClientStats, type LineRouter, type StoredLines } from "@micro-teams/multipath";
import { isWeb } from "../platform/platform";
import { storage } from "../platform/storage";
import type { Wire } from "./updates/socket";

/** How long after the start requests wait for the first live session before going to the network. */
const FALLBACK_AFTER = 3000;
/** How long a GET waits for the head of its answer, or a socket for its stream to open, before
 * going to the network: a line that died silently is noticed within a second, and every live line
 * answers well within this. */
const REQUEST_WAIT = 10_000;
/** How long after a session ended a request still waits for the next one. */
const REPLACING = 5000;
/** How many fallbacks and events the diagnostics keep. */
const KEPT = 50;

export type Diagnostics = {
  origin: string;
  at: string;
  client: ClientStats;
  fallbacks: { count: number; recent: { at: string; url: string; reason: string }[] };
  events: { at: string; event: ClientEvent }[];
};

type Inner = { send(d: string | Uint8Array): void; close(): void } & Omit<Wire, "send" | "close">;

const native = !isWeb;
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

type Started = { client: Client; router: LineRouter };

export class Substrate {
  private started: Started | null = null;
  private readonly fallbacks: Diagnostics["fallbacks"] = { count: 0, recent: [] };
  private readonly events: Diagnostics["events"] = [];
  private endedAt = 0;
  private startedAt = 0;

  constructor(
    private readonly origin: string,
    dial: boolean,
  ) {
    if (dial) this.start();
  }

  start(): Started {
    if (this.started) return this.started;
    this.startedAt = Date.now();
    const key = `multipath-lines:${this.origin}`;
    const onEvent = (event: ClientEvent) => {
      if (event.type === "fallback") return this.fellBack(event.url, event.reason);
      if (event.type === "session-end") this.endedAt = Date.now();
      this.events.push({ at: new Date().toISOString(), event });
      this.events.splice(0, this.events.length - KEPT);
    };
    const client = new Client({
      entry: this.origin,
      store: {
        load: async () => storage.getJson<StoredLines>(key),
        save: async (stored) => storage.setJson(key, stored),
      },
      compression: !native,
      buffered: native,
      onEvent,
    });
    const router = createLineRouter({
      entry: this.origin,
      client,
      fallbackAfterMs: FALLBACK_AFTER,
      requestTimeoutMs: REQUEST_WAIT,
      onEvent,
      log: (m) => console.warn(`multipath: ${m}`),
    });
    this.started = { client, router };
    return this.started;
  }

  private fellBack(url: string, reason: string) {
    this.fallbacks.count += 1;
    this.fallbacks.recent.push({ at: new Date().toISOString(), url: url.split("?")[0], reason });
    this.fallbacks.recent.splice(0, this.fallbacks.recent.length - KEPT);
  }

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request && !init ? input : new Request(input, init);
    const { client, router } = this.start();
    if (Date.now() - this.endedAt < REPLACING) await client.live(FALLBACK_AFTER);
    return router.fetch(request);
  };

  openSocket = (path: string): Wire => {
    const { client } = this.start();
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
    const name = path.split("?")[0];
    const direct = (reason: string) => {
      console.warn(`multipath: socket ${name} goes to the network: ${reason}`);
      this.fellBack(`${this.origin}${name}`, reason);
      const ws = new WebSocket(asWebSocket(this.origin) + path);
      ws.binaryType = "arraybuffer"; // binary frames as bytes, as they arrive over the lines
      attach(ws as unknown as Inner, false);
    };
    void (async () => {
      // Waiting is worth it only while a session may still come: in the start's first
      // FALLBACK_AFTER, or while one that just ended is replaced. With none otherwise (a line list
      // this page cannot use, say), every open would wait FALLBACK_AFTER for nothing.
      const now = Date.now();
      const wait = now - this.endedAt < REPLACING ? FALLBACK_AFTER : Math.max(0, FALLBACK_AFTER - (now - this.startedAt));
      if (!(await client.live(wait))) return direct(wait > 0 ? `no live session within ${wait} ms` : "no live session");
      const opening = client.openWebSocket(path);
      try {
        const ws = await within(opening, REQUEST_WAIT);
        if (ws === "late") {
          void opening.then((late) => late.close(), () => {});
          return direct(`not open over the lines within ${REQUEST_WAIT} ms`);
        }
        attach(ws as unknown as Inner, true);
      } catch (e) {
        console.warn(`multipath: socket ${name} failed over the lines: ${String(e)}`);
        wire.onerror?.(e);
      }
    })();
    return wire;
  };

  diagnostics(): Diagnostics {
    return {
      origin: this.origin,
      at: new Date().toISOString(),
      client: this.start().client.stats(),
      fallbacks: { count: this.fallbacks.count, recent: [...this.fallbacks.recent] },
      events: [...this.events],
    };
  }

  close() {
    if (this.started) void this.started.client.close();
  }
}
