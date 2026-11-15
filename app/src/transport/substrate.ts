/*
 * The substrate: one redundant MultiPath stream to the origin, carried over every line the
 * deployment publishes, with each HTTP exchange a stream on top of it.
 *
 * new Substrate(origin) — starts with the line list it saved last time, so the very first request
 *   can already go over every line; adopt(lines) replaces it (and saves it) when /mt/lines answers.
 * substrate.fetch(input, init) — fetch(), over the substrate when one is up, directly otherwise.
 *   Never waits for a dial: until one completes, requests go out the ordinary way.
 * substrate.stats() — each line's health, for the lines panel; error() — why the last dial failed.
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
  private dialling = false;
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

  private live(): Client | null {
    if (this.client || this.dialling) return this.client;
    this.dialling = true;
    Client.dial(this.lines.map(asWebSocket)).then(
      (c) => {
        this.client = c;
        this.dialling = false;
        this.lastError = null;
        console.log(`multipath: substrate up over ${this.lines.join(", ")}`);
      },
      (e: unknown) => {
        this.dialling = false;
        this.lastError = e instanceof Error ? e.message : String(e);
        console.warn(`multipath: no substrate over ${this.lines.join(", ")}, sending directly: ${this.lastError}`);
      },
    );
    return null;
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
  }
}
