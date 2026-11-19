/*
 * What the outbox owes a person who pressed send: delivery, or the message given back.
 *
 * Run with `npm test`. post() is a fake that answers as the server would; storage is the test
 * build of MMKV, so a second Outbox for the same conversation reads what the first one saved.
 */
import type { Message } from "./merge";
import { isStuck, Outbox } from "./outbox";

const stored = (content: string, clientToken: string): Message => ({
  id: 1,
  threadId: 9,
  senderId: 1,
  content,
  clientToken,
  createdAt: "2026-11-15T00:00:00Z",
});

const settle = () => new Promise<void>((r) => setImmediate(() => r()));
let thread = 100;

test("a message the server takes stops being pending and is handed over", async () => {
  const sent: Message[] = [];
  const box = new Outbox(thread++, async (c, t) => stored(c, t), (m) => m && sent.push(m));
  box.enqueue("hello");
  expect(box.pending.map((p) => p.content)).toEqual(["hello"]);
  await settle();
  expect(box.pending).toEqual([]);
  expect(sent.map((m) => m.content)).toEqual(["hello"]);
});

test("a failing send stays queued with its reason, and survives a restart", async () => {
  const id = thread++;
  const box = new Outbox(id, async () => Promise.reject(new Error("offline")), () => {});
  box.enqueue("hello");
  await settle();
  expect(box.pending[0]).toMatchObject({ content: "hello", attempts: 1, lastError: "offline" });
  box.dispose();
  const again = new Outbox(id, async () => Promise.reject(new Error("still offline")), () => {});
  expect(again.pending.map((p) => p.content)).toEqual(["hello"]);
  again.dispose();
});

test("a refusal is final rather than retried forever", async () => {
  const refused = Object.assign(new Error("not a member"), { status: 403 });
  const box = new Outbox(thread++, async () => Promise.reject(refused), () => {});
  box.enqueue("hello");
  await settle();
  expect(isStuck(box.pending[0])).toBe(true);
  box.dispose();
});

test("giving up returns the text, and a stored token reconciles", () => {
  const box = new Outbox(thread++, () => new Promise(() => {}), () => {});
  box.enqueue("one");
  box.enqueue("two");
  const [first, second] = box.pending;
  expect(box.discard(first.clientToken)).toBe("one");
  box.reconcile([stored("two", second.clientToken)]);
  expect(box.pending).toEqual([]);
  box.dispose();
});
