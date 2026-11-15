/*
 * Who is subscribed to what, what the server has said about it, and whether what a screen holds
 * still agrees with what the server says it should hold. No socket and no React: both are wired
 * in from outside, so the awkward cases (a hole in the stream, a reconnect, a restarted server, a
 * digest that disagrees) are plain function calls in a test.
 *
 * new UpdatesStore()
 * store.subscribe(topic, { onChange(reason), digest?() }) → unsubscribe — reference-counted per
 *   topic. digest() answers the periodic check with what the subscriber holds, or null while it is
 *   still loading.
 * store.connected(send) — a socket is up; send is how frames reach it. Everything is resubscribed
 *   from its cursor and fired once, because nothing says what happened while the socket was down.
 * store.disconnected() — the socket is gone; frames are not sent until the next connected().
 * store.refocused() — the app came back to the foreground; every topic fires once.
 * store.handle(frame) — one frame from the server.
 * store.cursorOf(topic) — the furthest seq known for a topic, or undefined.
 * store.mismatches — how many periodic checks found a subscriber out of date: zero on a healthy
 *   system, and each one is logged with its topic.
 * SyncReason — why a subscriber is being told to look again.
 *
 * Example:
 *   const drop = store.subscribe("thread:5", { onChange: () => refetch(), digest: () => held() });
 *
 * The store holds cursors, digests and callbacks, never data: a lost or duplicated frame can cost a
 * refetch, and can never put a wrong message on screen.
 */
import { ClientFrame, ServerFrame } from "./protocol";

export type SyncReason = "event" | "hole" | "gap" | "reconnect" | "mismatch";

export interface TopicListener {
  onChange: (reason: SyncReason) => void;
  digest?: () => string | null;
}

export class UpdatesStore {
  private readonly listeners = new Map<string, Set<TopicListener>>();
  private readonly cursors = new Map<string, number>();
  private send: ((frame: ClientFrame) => void) | null = null;
  readonly refused = new Set<string>();
  mismatches = 0;

  get isConnected() {
    return this.send !== null;
  }

  connected(send: (frame: ClientFrame) => void) {
    this.send = send;
    const topics = [...this.listeners.keys()];
    if (!topics.length) return;
    const since: Record<string, number> = {};
    for (const t of topics) {
      const at = this.cursors.get(t);
      if (at !== undefined) since[t] = at;
    }
    send({ t: "sub", topics, since });
    for (const t of topics) this.fire(t, "reconnect");
  }

  disconnected() {
    this.send = null;
  }

  refocused() {
    for (const t of [...this.listeners.keys()]) this.fire(t, "reconnect");
  }

  subscribe(topic: string, listener: TopicListener): () => void {
    let set = this.listeners.get(topic);
    if (!set) {
      set = new Set();
      this.listeners.set(topic, set);
      this.send?.({ t: "sub", topics: [topic] });
    }
    set.add(listener);
    return () => {
      const current = this.listeners.get(topic);
      if (!current) return;
      current.delete(listener);
      if (current.size) return;
      this.listeners.delete(topic);
      this.send?.({ t: "unsub", topics: [topic] });
    };
  }

  cursorOf(topic: string): number | undefined {
    return this.cursors.get(topic);
  }

  handle(frame: ServerFrame) {
    switch (frame.t) {
      case "event": {
        const at = this.cursors.get(frame.topic);
        // The chain does not line up: something was published that never reached us.
        const hole = frame.prev !== null && at !== undefined && frame.prev !== at;
        this.advance(frame.topic, frame.seq);
        this.fire(frame.topic, hole ? "hole" : "event");
        break;
      }
      case "state":
        this.advance(frame.topic, frame.seq);
        this.check(frame.topic, frame.digest);
        break;
      case "gap":
        if (frame.seq !== null) this.advance(frame.topic, frame.seq);
        this.fire(frame.topic, "gap");
        break;
      case "ack":
        for (const t of frame.refused) this.refused.add(t);
        for (const t of frame.granted) this.refused.delete(t);
        // Only a cursor we do not have: our own fetches may have seen further than the socket said.
        for (const [t, seq] of Object.entries(frame.cursors)) if (!this.cursors.has(t)) this.cursors.set(t, seq);
        break;
      case "pong":
      case "err":
        break;
    }
  }

  private check(topic: string, expected: string) {
    for (const l of [...(this.listeners.get(topic) ?? [])]) {
      const mine = l.digest?.() ?? null;
      if (mine === null || mine === expected) continue;
      this.mismatches += 1;
      console.warn(`updates: ${topic} should be "${expected}" but we hold "${mine}" — refetching; an event for this was never delivered`);
      this.call(l, "mismatch");
    }
  }

  private advance(topic: string, seq: number) {
    const at = this.cursors.get(topic);
    if (at === undefined || seq > at) this.cursors.set(topic, seq);
  }

  private fire(topic: string, reason: SyncReason) {
    for (const l of [...(this.listeners.get(topic) ?? [])]) this.call(l, reason);
  }

  private call(l: TopicListener, reason: SyncReason) {
    try {
      l.onChange(reason);
    } catch (e) {
      // One screen's bug must not stop the others from being told.
      console.warn(`updates: a listener threw: ${String(e)}`);
    }
  }
}
