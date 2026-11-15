/*
 * The substrate: one redundant MultiPath stream to the origin, carried over every line the
 * deployment publishes, with each HTTP exchange a stream on top of it.
 *
 * new Substrate(origin) — starts with the line list it saved last time, so the very first request
 *   can already go over every line; adopt(lines) replaces it (and saves it) when /mt/lines answers.
 * substrate.fetch(input, init) — fetch(), over the substrate when one is up, directly otherwise.
 *   Never waits for a dial: until one completes, requests go out the ordinary way.
 * substrate.stats() — each line's health, for the lines panel; error() — why the last dial failed.
 * substrate.openSocket(path) → Wire — a WebSocket to the origin: a stream over the substrate,
 *   waiting for a dial in flight, or directly when the dial failed; the UpdatesSocket's open().
 * substrate.linesInUse() — the line list the next dial uses.
 * substrate.reset() — drop the client; the next request dials again (the app came back from the
 *   background and the old links may be silently dead).
 *
 * Example: const s = new Substrate(origin); const res = await s.fetch(`${origin}/mt/chat`);
 *
 * Going out directly while there is no substrate is part of the design (the request that fetches
 * the line list cannot wait for those lines), so it is announced rather than hidden: a failed dial
 * is logged and shown in the lines panel.
 */
import { Client, type LinkStat } from "@micro-teams/multipath";
import { storage } from "../platform/storage";
import type { Wire } from "./updates/socket";

const SERVICE = "app";

function lineKey(origin: string) {
  return `lines:${origin}`;
}

function asWebSocket(url: string) {
  return url.replace(/^http/, "ws");
}

export class Substrate {
  private lines: string[];
  private client: Client | null = null;
  private lastError: string | null = null;

  constructor(private readonly origin: string) {
    this.lines = storage.getJson<string[]>(lineKey(origin)) ?? [origin];
  }

  adopt(lines: string[]) {
    const next = lines.length ? lines : [this.origin];
    storage.setJson(lineKey(this.origin), next);
    if (next.join() === this.lines.join()) return;
    this.lines = next;
    this.reset();
  }

  private dial: Promise<Client | null> | null = null;

  /** The client if one is up; otherwise starts a dial (once) and returns null. */
  private live(): Client | null {
    if (!this.client && !this.dial) this.dialled();
    return this.client;
  }

  /** The client, waiting for a dial in flight; null when it failed. */
  private dialled(): Promise<Client | null> {
    if (this.client) return Promise.resolve(this.client);
    if (this.dial) return this.dial;
    const lines = this.lines;
    this.dial = Client.dial(lines.map(asWebSocket)).then(
      (c) => {
        this.client = c;
        this.lastError = null;
        console.log(`multipath: substrate up over ${lines.join(", ")}`);
        return c;
      },
      (e: unknown) => {
        this.dial = null;
        this.lastError = e instanceof Error ? e.message : String(e);
        console.warn(`multipath: no substrate over ${lines.join(", ")}, sending directly: ${this.lastError}`);
        return null;
      },
    );
    return this.dial;
  }

  fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const client = this.live();
    if (!client) return globalThis.fetch(input, init);
    const request = input instanceof Request && !init ? input : new Request(input, init);
    const started = Date.now();
    return client.fetch(SERVICE, request).then(
      (res) => res,
      (e: unknown) => {
        console.warn(`multipath: ${request.method} ${request.url} failed after ${Date.now() - started} ms: ${String(e)}`);
        throw e;
      },
    );
  };

  openSocket = (path: string): Wire => {
    type Inner = { send(d: string | Uint8Array): void; close(): void; binaryType?: string };
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
    const adopt = (ws: Inner & Omit<Wire, "send" | "close">, opened: boolean) => {
      if (dropped) {
        ws.close();
        return;
      }
      inner = ws;
      ws.onmessage = (ev) => wire.onmessage?.(ev);
      ws.onclose = () => wire.onclose?.();
      ws.onerror = (e) => wire.onerror?.(e);
      if (opened) wire.onopen?.();
      else ws.onopen = () => wire.onopen?.();
    };
    // Over the substrate once it is up — waiting for a dial in flight rather than racing it.
    this.dialled().then(async (client) => {
      if (client) {
        try {
          adopt((await client.openWebSocket(SERVICE, path)) as unknown as Inner & Omit<Wire, "send" | "close">, true);
        } catch (e) {
          wire.onerror?.(e);
        }
        return;
      }
      console.warn(`multipath: no substrate, opening ${path.split("?")[0]} directly`);
      const ws = new WebSocket(asWebSocket(this.origin) + path);
      ws.binaryType = "arraybuffer"; // binary frames as bytes, as they arrive over the substrate
      adopt(ws as unknown as Inner & Omit<Wire, "send" | "close">, false);
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
    this.dial = null;
  }
}
