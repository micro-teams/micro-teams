// What the store must get right, tested without a socket or a browser.
//
// The cases worth having are the ones a manual click-through cannot produce: a reconnect while two
// panes watch the same topic, an ack that arrives after our own fetch already saw further, a
// refusal.

import { describe, expect, it, vi } from "vitest";
import { UpdatesStore } from "@/lib/updates/store";
import { parseFrame } from "@/lib/updates/protocol";

const transport = () => {
  const sent: unknown[] = [];
  return { sent, send: (frame: unknown) => sent.push(frame) };
};

describe("UpdatesStore", () => {
  it("tells a listener when its topic moves", () => {
    const store = new UpdatesStore();
    const seen: string[] = [];
    store.subscribe("thread:7", (reason) => seen.push(reason));

    store.handle({ t: "event", topic: "thread:7", seq: 100 });

    expect(seen).toEqual(["event"]);
    expect(store.cursorOf("thread:7")).toBe(100);
  });

  it("does not tell a listener about someone else's topic", () => {
    const store = new UpdatesStore();
    const listener = vi.fn();
    store.subscribe("thread:7", listener);

    store.handle({ t: "event", topic: "thread:8", seq: 100 });

    expect(listener).not.toHaveBeenCalled();
  });

  it("subscribes once for many listeners and unsubscribes on the last one", () => {
    const store = new UpdatesStore();
    const t = transport();
    store.connected(t);
    const offA = store.subscribe("thread:7", () => {});
    const offB = store.subscribe("thread:7", () => {});

    expect(t.sent).toEqual([{ t: "sub", topics: ["thread:7"] }]);

    offA();
    expect(t.sent).toHaveLength(1); // still watched by B

    offB();
    expect(t.sent[1]).toEqual({ t: "unsub", topics: ["thread:7"] });
  });

  it("resubscribes everything on reconnect, carrying its cursors", () => {
    const store = new UpdatesStore();
    store.subscribe("thread:7", () => {});
    store.handle({ t: "event", topic: "thread:7", seq: 100 });

    const t = transport();
    store.connected(t);

    expect(t.sent).toEqual([
      { t: "sub", topics: ["thread:7"], since: { "thread:7": 100 } },
    ]);
  });

  it("treats a reconnect as a reason to refetch", () => {
    const store = new UpdatesStore();
    const seen: string[] = [];
    store.subscribe("thread:7", (reason) => seen.push(reason));

    store.connected(transport());

    // We cannot know what happened while the socket was down until the server answers, and the
    // answer may be a gap — so the reconnect itself is worth one fetch.
    expect(seen).toEqual(["reconnect"]);
  });

  it("passes a gap on as its own reason", () => {
    const store = new UpdatesStore();
    const seen: string[] = [];
    store.subscribe("thread:7", (reason) => seen.push(reason));

    store.handle({ t: "gap", topic: "thread:7", seq: 900 });

    expect(seen).toEqual(["gap"]);
    expect(store.cursorOf("thread:7")).toBe(900);
  });

  it("never walks a cursor backwards", () => {
    const store = new UpdatesStore();
    store.handle({ t: "event", topic: "thread:7", seq: 100 });
    store.handle({ t: "event", topic: "thread:7", seq: 99 });

    expect(store.cursorOf("thread:7")).toBe(100);
  });

  it("does not let an ack move a cursor we already hold", () => {
    const store = new UpdatesStore();
    store.handle({ t: "event", topic: "thread:7", seq: 100 });

    store.handle({
      t: "ack",
      granted: ["thread:7"],
      refused: [],
      cursors: { "thread:7": 50 },
    });

    expect(store.cursorOf("thread:7")).toBe(100);
  });

  it("records a refusal so it is not mistaken for a quiet topic", () => {
    const store = new UpdatesStore();

    store.handle({ t: "ack", granted: [], refused: ["thread:9"], cursors: {} });
    expect(store.refused.has("thread:9")).toBe(true);

    store.handle({ t: "ack", granted: ["thread:9"], refused: [], cursors: {} });
    expect(store.refused.has("thread:9")).toBe(false);
  });

  it("keeps telling the other listeners when one of them throws", () => {
    const store = new UpdatesStore();
    const good = vi.fn();
    store.subscribe("thread:7", () => {
      throw new Error("a broken pane");
    });
    store.subscribe("thread:7", good);

    store.handle({ t: "event", topic: "thread:7", seq: 1 });

    expect(good).toHaveBeenCalledOnce();
  });

  it("stops sending once disconnected and resends on the next connect", () => {
    const store = new UpdatesStore();
    const first = transport();
    store.connected(first);
    store.subscribe("thread:7", () => {});
    store.disconnected();

    const second = transport();
    store.connected(second);

    expect(second.sent).toEqual([
      { t: "sub", topics: ["thread:7"], since: {} },
    ]);
  });
});

describe("parseFrame", () => {
  it("ignores a frame kind it has never heard of", () => {
    expect(parseFrame(JSON.stringify({ t: "from-the-future" }))).toBeNull();
  });

  it("ignores malformed json rather than throwing", () => {
    expect(parseFrame("{not json")).toBeNull();
  });

  it("ignores an event with no topic", () => {
    expect(parseFrame(JSON.stringify({ t: "event", seq: 1 }))).toBeNull();
  });

  it("reads an event", () => {
    expect(
      parseFrame(
        JSON.stringify({
          t: "event",
          topic: "thread:7",
          seq: 9,
          kind: "message.created",
        }),
      ),
    ).toEqual({
      t: "event",
      topic: "thread:7",
      seq: 9,
      kind: "message.created",
    });
  });

  it("survives an ack with fields missing", () => {
    expect(parseFrame(JSON.stringify({ t: "ack" }))).toEqual({
      t: "ack",
      granted: [],
      refused: [],
      cursors: {},
    });
  });
});
