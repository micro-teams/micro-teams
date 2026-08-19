// Who is subscribed to what, and what the socket has said about it. No React, no WebSocket — both
// are wired in from outside, which is what makes the awkward cases (a resubscribe after a drop, two
// components watching the same thread, a gap) testable without a browser.
//
// What this deliberately does NOT do: hold any chat data. It holds cursors and hands out "this
// topic moved, go and look". Keeping the data out of here is the whole reason the protocol is
// allowed to lose a frame — there is only ever one path by which data reaches the screen, and it is
// the same fetch that was there before this file existed.

export type TopicListener = (reason: "event" | "gap" | "reconnect") => void;

export interface UpdatesTransport {
  /** Send a frame. May be dropped while disconnected — resubscription is the store's job. */
  send: (frame: unknown) => void;
}

export class UpdatesStore {
  private listeners = new Map<string, Set<TopicListener>>();
  private cursors = new Map<string, number>();
  private transport: UpdatesTransport | null = null;

  /** Topics refused by the server. Kept so a refusal is visible rather than looking like silence. */
  readonly refused = new Set<string>();

  /**
   * Attach a live socket. Called on every (re)connect: everything currently listened to is
   * resubscribed in one frame, carrying the cursors we hold so the server can either replay what we
   * missed or tell us it cannot.
   */
  connected(transport: UpdatesTransport) {
    this.transport = transport;
    const topics = [...this.listeners.keys()];
    if (topics.length === 0) return;
    const since: Record<string, number> = {};
    for (const topic of topics) {
      const at = this.cursors.get(topic);
      if (at != null) since[topic] = at;
    }
    transport.send({ t: "sub", topics, since });
    // A reconnect is itself a reason to refetch: we cannot know what happened while the socket was
    // down until the server answers, and the answer may be a gap. Costing one fetch per reconnect
    // is the cheap half of this trade.
    for (const topic of topics) this.fire(topic, "reconnect");
  }

  disconnected() {
    this.transport = null;
  }

  /** Subscribe a listener to a topic. Returns the unsubscribe. Reference-counted per topic. */
  subscribe(topic: string, listener: TopicListener): () => void {
    let set = this.listeners.get(topic);
    if (!set) {
      set = new Set();
      this.listeners.set(topic, set);
      this.transport?.send({ t: "sub", topics: [topic] });
    }
    set.add(listener);
    return () => {
      const current = this.listeners.get(topic);
      if (!current) return;
      current.delete(listener);
      if (current.size > 0) return;
      this.listeners.delete(topic);
      this.transport?.send({ t: "unsub", topics: [topic] });
    };
  }

  /** Where we believe a topic stands. Exposed for tests and for reporting a disagreement. */
  cursorOf(topic: string): number | undefined {
    return this.cursors.get(topic);
  }

  /** Feed a parsed server frame in. Unknown frames never reach here (protocol.ts drops them). */
  handle(frame: {
    t: string;
    topic?: string;
    seq?: number;
    granted?: string[];
    refused?: string[];
    cursors?: Record<string, number>;
  }) {
    switch (frame.t) {
      case "event": {
        if (!frame.topic) return;
        if (frame.seq != null) this.advance(frame.topic, frame.seq);
        this.fire(frame.topic, "event");
        return;
      }
      case "gap": {
        if (!frame.topic) return;
        if (frame.seq != null) this.advance(frame.topic, frame.seq);
        this.fire(frame.topic, "gap");
        return;
      }
      case "ack": {
        for (const topic of frame.refused ?? []) this.refused.add(topic);
        for (const topic of frame.granted ?? []) this.refused.delete(topic);
        for (const [topic, seq] of Object.entries(frame.cursors ?? {})) {
          // Only adopt a cursor we do not have. Never move ours backwards on an ack: our own
          // fetches may legitimately have seen further than the socket has told us about.
          if (!this.cursors.has(topic)) this.cursors.set(topic, seq);
        }
        return;
      }
      default:
        return;
    }
  }

  private advance(topic: string, seq: number) {
    const at = this.cursors.get(topic);
    if (at == null || seq > at) this.cursors.set(topic, seq);
  }

  private fire(topic: string, reason: "event" | "gap" | "reconnect") {
    const set = this.listeners.get(topic);
    if (!set) return;
    for (const listener of [...set]) {
      try {
        listener(reason);
      } catch {
        // A listener that throws is a bug in that component; it must not stop the others from
        // being told, or one broken pane would silently freeze the rest of the app.
      }
    }
  }
}
