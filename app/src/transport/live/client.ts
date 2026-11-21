/*
 * Live requests, on the client: what every screen reads.
 *
 * A live request is an ordinary GET of the API that the server answers now and again whenever the
 * answer would differ (the backend's live module). The client keeps the latest answer of each one
 * and nothing else: a screen shows it, and a newer answer replaces it whole. The first load, an
 * update, a reconnect and a return to the foreground are therefore one path, and two screens can
 * only disagree for the moment between two answers.
 *
 * new LiveClient(store) — store is where answers are kept across restarts (platform storage).
 * client.subscribe(path, listener) → unsubscribe — reference-counted per path; listener() is called
 *   whenever the path's answer changes. Subscribing sends a get at once if the socket is up.
 * client.answer(path) → Answer | undefined — the latest answer: the server's, or, before the first
 *   one of this run, the one kept from the last run (marked fresh: false).
 * client.connected(send) — a socket is up: every subscription is asked for again on it.
 * client.disconnected() — the socket went away; answers stay as they are.
 * client.reauthorized(token) — a fresh token: the server answers every subscription again with it.
 * client.unauthorized — whether any answer of this run is a 401 (the token ran out).
 * client.handle(text) — one frame from the server.
 * client.clear() — forget every answer, kept ones included (signing out).
 * Answer — { status, body, fresh }.
 *
 * Example:
 *   const stop = client.subscribe("/chat?page_size=50", () => render(client.answer("/chat?page_size=50")));
 *
 * Answers are kept for the most recent KEPT paths and only when small enough (KEPT_BYTES), because
 * the web stores them in localStorage, which holds a few megabytes for everything.
 */

export type Answer = { status: number; body: unknown; fresh: boolean };

type Store = {
  getJson<T>(key: string): T | null;
  setJson(key: string, value: unknown): void;
  remove(key: string): void;
};

const KEPT = 120;
const KEPT_BYTES = 200_000;
const INDEX_KEY = "live:index";
const keyOf = (path: string) => `live:${path}`;

type Sub = { id: string; listeners: Set<() => void>; answer?: Answer };

export class LiveClient {
  private readonly subs = new Map<string, Sub>();
  private readonly byId = new Map<string, string>();
  private send: ((text: string) => void) | null = null;
  private next = 1;
  private index: string[];

  constructor(private readonly store: Store) {
    this.index = store.getJson<string[]>(INDEX_KEY) ?? [];
  }

  subscribe(path: string, listener: () => void): () => void {
    let sub = this.subs.get(path);
    if (!sub) {
      const id = `q${this.next++}`;
      const kept = this.store.getJson<{ status: number; body: unknown }>(keyOf(path));
      sub = { id, listeners: new Set(), answer: kept ? { ...kept, fresh: false } : undefined };
      this.subs.set(path, sub);
      this.byId.set(id, path);
      this.get(sub.id, path);
    }
    sub.listeners.add(listener);
    return () => {
      const current = this.subs.get(path);
      if (!current) return;
      current.listeners.delete(listener);
      if (current.listeners.size) return;
      this.subs.delete(path);
      this.byId.delete(current.id);
      this.send?.(JSON.stringify({ t: "stop", id: current.id }));
    };
  }

  answer(path: string): Answer | undefined {
    return this.subs.get(path)?.answer;
  }

  connected(send: (text: string) => void) {
    this.send = send;
    for (const [path, sub] of this.subs) this.get(sub.id, path);
  }

  disconnected() {
    this.send = null;
  }

  /** Ask for every subscription again: a fresh token makes answers that were 401 good. */
  reauthorized(token: string) {
    this.send?.(JSON.stringify({ t: "auth", token }));
  }

  handle(text: string) {
    let frame: { t?: string; id?: string; status?: number; body?: unknown };
    try {
      frame = JSON.parse(text);
    } catch {
      return;
    }
    if (frame.t !== "result" || !frame.id) return;
    const path = this.byId.get(frame.id);
    const sub = path ? this.subs.get(path) : undefined;
    if (!path || !sub) return;
    sub.answer = { status: frame.status ?? 0, body: frame.body ?? null, fresh: true };
    if (sub.answer.status === 200) this.keep(path, { status: 200, body: sub.answer.body });
    for (const l of [...sub.listeners]) {
      try {
        l();
      } catch (e) {
        // One screen's bug must not stop the others from being told.
        console.warn(`live: a listener threw: ${String(e)}`);
      }
    }
  }

  /** Whether any answer is a 401: the token has run out. */
  get unauthorized(): boolean {
    for (const sub of this.subs.values()) if (sub.answer?.fresh && sub.answer.status === 401) return true;
    return false;
  }

  clear() {
    for (const path of this.index) this.store.remove(keyOf(path));
    this.index = [];
    this.store.setJson(INDEX_KEY, this.index);
    for (const sub of this.subs.values()) sub.answer = undefined;
  }

  private get(id: string, path: string) {
    this.send?.(JSON.stringify({ t: "get", id, path }));
  }

  private keep(path: string, value: { status: number; body: unknown }) {
    const text = JSON.stringify(value);
    if (text.length > KEPT_BYTES) return;
    this.store.setJson(keyOf(path), value);
    this.index = [path, ...this.index.filter((p) => p !== path)];
    for (const old of this.index.splice(KEPT)) this.store.remove(keyOf(old));
    this.store.setJson(INDEX_KEY, this.index);
  }
}
