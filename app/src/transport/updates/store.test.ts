/*
 * What the sync layer must get right, without a socket: a reconnect while two screens watch one
 * topic, an ack that arrives after our own fetch saw further, a hole in the event chain, a digest
 * that disagrees, a frame from a newer server.
 *
 * Run with `npm test`.
 */
import { ClientFrame, parseFrame, ServerFrame } from "./protocol";
import { SyncReason, UpdatesStore } from "./store";

const ev = (topic: string, seq: number, prev: number | null = null): ServerFrame => ({ t: "event", topic, seq, prev, kind: "" });
const wire = () => {
  const sent: ClientFrame[] = [];
  return { sent, send: (f: ClientFrame) => sent.push(f) };
};
const watching = (store: UpdatesStore, topic: string, digest?: () => string | null) => {
  const seen: SyncReason[] = [];
  store.subscribe(topic, { onChange: (r) => seen.push(r), digest });
  return seen;
};

describe("UpdatesStore", () => {
  test("tells a listener when its topic moves, and only its topic", () => {
    const store = new UpdatesStore();
    const seen = watching(store, "thread:7");
    store.handle(ev("thread:8", 5));
    store.handle(ev("thread:7", 100));
    expect(seen).toEqual(["event"]);
    expect(store.cursorOf("thread:7")).toBe(100);
  });

  test("subscribes once for many listeners and unsubscribes on the last one", () => {
    const store = new UpdatesStore();
    const w = wire();
    store.connected(w.send);
    const offA = store.subscribe("thread:7", { onChange: () => {} });
    const offB = store.subscribe("thread:7", { onChange: () => {} });
    expect(w.sent).toEqual([{ t: "sub", topics: ["thread:7"] }]);
    offA();
    expect(w.sent).toHaveLength(1);
    offB();
    expect(w.sent[1]).toEqual({ t: "unsub", topics: ["thread:7"] });
  });

  test("resubscribes everything on reconnect, carrying its cursors, and refetches once", () => {
    const store = new UpdatesStore();
    const seen = watching(store, "thread:7");
    store.handle(ev("thread:7", 100));
    const w = wire();
    store.connected(w.send);
    expect(w.sent).toEqual([{ t: "sub", topics: ["thread:7"], since: { "thread:7": 100 } }]);
    expect(seen).toEqual(["event", "reconnect"]);
  });

  test("a gap is its own reason, with or without a cursor", () => {
    const store = new UpdatesStore();
    const seen = watching(store, "thread:7");
    store.handle({ t: "gap", topic: "thread:7", seq: 900 });
    store.handle({ t: "gap", topic: "thread:7", seq: null });
    expect(seen).toEqual(["gap", "gap"]);
    expect(store.cursorOf("thread:7")).toBe(900);
  });

  test("never walks a cursor backwards, not even on an ack", () => {
    const store = new UpdatesStore();
    store.handle(ev("thread:7", 100));
    store.handle(ev("thread:7", 99));
    store.handle({ t: "ack", granted: ["thread:7"], refused: [], cursors: { "thread:7": 50 } });
    expect(store.cursorOf("thread:7")).toBe(100);
  });

  test("records a refusal so it is not mistaken for a quiet topic", () => {
    const store = new UpdatesStore();
    store.handle({ t: "ack", granted: [], refused: ["thread:9"], cursors: {} });
    expect(store.refused.has("thread:9")).toBe(true);
    store.handle({ t: "ack", granted: ["thread:9"], refused: [], cursors: {} });
    expect(store.refused.has("thread:9")).toBe(false);
  });

  test("keeps telling the other listeners when one of them throws", () => {
    const store = new UpdatesStore();
    store.subscribe("thread:7", {
      onChange: () => {
        throw new Error("a broken pane");
      },
    });
    const seen = watching(store, "thread:7");
    store.handle(ev("thread:7", 1));
    expect(seen).toEqual(["event"]);
  });

  test("stops sending once disconnected and resends on the next connect", () => {
    const store = new UpdatesStore();
    const first = wire();
    store.connected(first.send);
    store.subscribe("thread:7", { onChange: () => {} });
    store.disconnected();
    const second = wire();
    store.connected(second.send);
    expect(second.sent).toEqual([{ t: "sub", topics: ["thread:7"], since: {} }]);
  });

  test("refetches when the event chain does not line up, but not on the first event", () => {
    const store = new UpdatesStore();
    const seen = watching(store, "thread:7");
    store.handle(ev("thread:7", 100, 99));
    store.handle(ev("thread:7", 102, 101));
    expect(seen).toEqual(["event", "hole"]);
  });

  test("a digest that disagrees refetches and is counted; one that agrees, or is still loading, is not", () => {
    const store = new UpdatesStore();
    const stale = watching(store, "thread:7", () => "100:5");
    const fine = watching(store, "thread:8", () => "100:5");
    const loading = watching(store, "thread:9", () => null);
    store.handle({ t: "state", topic: "thread:7", seq: 101, digest: "101:6" });
    store.handle({ t: "state", topic: "thread:8", seq: 100, digest: "100:5" });
    store.handle({ t: "state", topic: "thread:9", seq: 100, digest: "100:5" });
    expect([stale, fine, loading]).toEqual([["mismatch"], [], []]);
    expect(store.mismatches).toBe(1);
  });

  test("coming back to the foreground refetches everything once", () => {
    const store = new UpdatesStore();
    const a = watching(store, "thread:7");
    const b = watching(store, "chats:1");
    store.refocused();
    expect([a, b]).toEqual([["reconnect"], ["reconnect"]]);
  });
});

describe("parseFrame", () => {
  test("ignores what it does not understand rather than throwing", () => {
    expect(parseFrame(JSON.stringify({ t: "from-the-future" }))).toBeNull();
    expect(parseFrame("{not json")).toBeNull();
    expect(parseFrame(JSON.stringify({ t: "event", seq: 1 }))).toBeNull();
    expect(parseFrame(JSON.stringify({ t: "state", topic: "thread:7" }))).toBeNull();
  });

  test("reads an event, a state frame and a sparse ack", () => {
    expect(parseFrame(JSON.stringify({ t: "event", topic: "thread:7", seq: 9, kind: "message.created" }))).toEqual({
      t: "event",
      topic: "thread:7",
      seq: 9,
      prev: null,
      kind: "message.created",
    });
    expect(parseFrame(JSON.stringify({ t: "state", topic: "thread:7", seq: 9, digest: "9:2" }))).toEqual({
      t: "state",
      topic: "thread:7",
      seq: 9,
      digest: "9:2",
    });
    expect(parseFrame(JSON.stringify({ t: "ack" }))).toEqual({ t: "ack", granted: [], refused: [], cursors: {} });
  });
});
