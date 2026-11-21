/*
 * Messages a person has sent that the server has not confirmed yet.
 *
 * new Outbox(threadId, post, onChange) — restores what was queued for this conversation when the
 *   app was last killed and starts delivering it at once. post(content, clientToken) sends one
 *   message and resolves with the stored one, or throws an error with a `status` when refused.
 * outbox.pending — what is waiting, oldest first: { clientToken, content, attempts, lastError }.
 * outbox.enqueue(text) — queue a message; it is drawn at once and delivered in order.
 * outbox.retry(clientToken) — try again now instead of waiting out the backoff.
 * outbox.discard(clientToken) → the text, so the composer can take it back.
 * outbox.reconcile(stored) — anything the server already holds stops being pending, matched by
 *   clientToken, so a send whose answer was lost is recognised rather than sent twice.
 * outbox.dispose() — stop retrying (the conversation was closed).
 * isStuck(pending) — whether it has failed often enough that the person should be told.
 *
 * Pending — a message not yet stored: its client token, text, how often it was tried, and the
 *   last error.
 *
 * Example:
 *   const box = new Outbox(5, (content, clientToken) => api.post(5, content, clientToken), redraw);
 *   box.enqueue("hello");
 *
 * A send is a promise to the person, not a request: it is kept on disk until the server takes it or
 * the person gives it up, retried with a widening gap, and a refusal (403, 404) is final rather
 * than retried forever. The clientToken is what makes a blind retry safe: the server stores a
 * token once per conversation and answers a repeat with the message it already has.
 */
import type { Message } from "./chats";
import { storage } from "../platform/storage";

export type Pending = { clientToken: string; content: string; attempts: number; lastError: string | null };

const BACKOFF_MS = [1000, 2000, 5000, 15000, 30000];

export function isStuck(p: Pending): boolean {
  return p.attempts >= 3;
}

function token(): string {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 2 ** 30).toString(36)}`;
}

export class Outbox {
  private queue: Pending[];
  private sending = false;
  private disposed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly threadId: number,
    private readonly post: (content: string, clientToken: string) => Promise<Message>,
    private readonly onChange: (sent?: Message) => void,
  ) {
    const saved = storage.getJson<{ clientToken: string; content: string }[]>(this.key) ?? [];
    this.queue = saved.map((p) => ({ ...p, attempts: 0, lastError: null }));
    if (this.queue.length) void this.drain();
  }

  private get key() {
    return `outbox:${this.threadId}`;
  }

  get pending(): readonly Pending[] {
    return this.queue;
  }

  enqueue(text: string) {
    const content = text.trim();
    if (!content) return;
    this.queue = [...this.queue, { clientToken: token(), content, attempts: 0, lastError: null }];
    this.changed();
    void this.drain();
  }

  retry(clientToken: string) {
    this.queue = this.queue.map((p) => (p.clientToken === clientToken ? { ...p, attempts: 0, lastError: null } : p));
    this.changed();
    void this.drain();
  }

  discard(clientToken: string): string | null {
    const item = this.queue.find((p) => p.clientToken === clientToken);
    if (!item) return null;
    this.queue = this.queue.filter((p) => p !== item);
    this.changed();
    return item.content;
  }

  reconcile(stored: Message[]) {
    const tokens = new Set(stored.map((m) => m.clientToken).filter(Boolean));
    const before = this.queue.length;
    this.queue = this.queue.filter((p) => !tokens.has(p.clientToken));
    if (this.queue.length !== before) this.changed();
  }

  dispose() {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private changed(sent?: Message) {
    storage.setJson(
      this.key,
      this.queue.map(({ clientToken, content }) => ({ clientToken, content })),
    );
    this.onChange(sent);
  }

  private async drain() {
    if (this.sending || this.disposed) return;
    this.sending = true;
    try {
      while (this.queue.length && !this.disposed) {
        const item = this.queue[0];
        try {
          const stored = await this.post(item.content, item.clientToken);
          this.queue = this.queue.filter((p) => p.clientToken !== item.clientToken);
          this.changed(stored);
        } catch (e) {
          const status = (e as { status?: number }).status;
          if (status === 403 || status === 404) {
            // Refused for good: retrying would be a spinner that never ends.
            this.queue = this.queue.map((p) => (p === item ? { ...p, attempts: 3, lastError: String((e as Error).message ?? e) } : p));
            this.changed();
            return;
          }
          const failed = { ...item, attempts: item.attempts + 1, lastError: e instanceof Error ? e.message : String(e) };
          this.queue = this.queue.map((p) => (p === item ? failed : p));
          this.changed();
          const wait = BACKOFF_MS[Math.min(failed.attempts - 1, BACKOFF_MS.length - 1)];
          this.timer = setTimeout(() => void this.drain(), wait);
          return;
        }
      }
    } finally {
      this.sending = false;
    }
  }
}
