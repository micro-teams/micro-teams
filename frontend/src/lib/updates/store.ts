// Who is subscribed to what, what the server has said about it, and — the part that earns this
// file's keep — whether what we hold still agrees with what the server says it should be.
//
// No React, no WebSocket: both are wired in from outside, which is what makes the awkward cases (a
// hole in the stream, a reconnect, a server that restarted, a digest that disagrees) testable
// without a browser.
//
// What this deliberately does NOT hold is data. It holds cursors, digests and callbacks, and tells
// a feature "go and look". Keeping the data out is what keeps exactly one path to the screen, which
// is the whole reason a lost or duplicated frame here can never show a wrong message.
//
// A subscriber may supply `digest`, a function over the data it already holds. That is the one
// thing a feature must provide beyond "refetch me", and it has to: only the feature knows what it
// is holding. Without it the periodic check still arrives — it just cannot be compared, so a topic
// with no digest falls back to trusting the event stream.

export type SyncReason =
  /** An ordinary event: the topic moved. */
  | "event"
  /** A frame never arrived — the event chain does not line up with our cursor. */
  | "hole"
  /** The server cannot catch us up (it restarted, or we were away too long). */
  | "gap"
  /** The socket came back; we cannot know what happened while it was down. */
  | "reconnect"
  /** What we hold disagrees with what the server says it should be. This one is a bug report. */
  | "mismatch";

export interface TopicListener {
  onChange: (reason: SyncReason) => void;
  /** A short description of what this subscriber currently holds, or null if it holds nothing yet. */
  digest?: () => string | null;
}

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
   * How many times a periodic check found us out of date. Zero on a healthy system: an event was
   * published for everything that happened. Anything else means the push side missed something,
   * and the log line names which topic — which is the difference between this and a poll, because
   * a poll repairs the same symptom and tells nobody.
   */
  mismatches = 0;

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
    // We cannot know what happened while the socket was down until the server answers, and the
    // answer may be a gap. One fetch per reconnect is the cheap half of that trade.
    for (const topic of topics) this.fire(topic, "reconnect");
  }

  disconnected() {
    this.transport = null;
  }

  /**
   * The tab came back to the front. Everything being watched refetches once.
   *
   * This is the one backstop that should never be removed, and it is not a poll: it costs one fetch
   * per time a human looks at the page, which is bounded by the human. It is what covers the cases
   * the digests deliberately leave out (an edit, a rename, a change that keeps every count the
   * same) and the case where this client was suspended by the OS and cannot know what it missed.
   */
  refocused() {
    for (const topic of this.listeners.keys()) this.fire(topic, "reconnect");
  }

  /** Subscribe. Returns the unsubscribe. Reference-counted per topic. */
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

  cursorOf(topic: string): number | undefined {
    return this.cursors.get(topic);
  }

  /** Feed a parsed server frame in. Unknown frames never reach here (protocol.ts drops them). */
  handle(frame: {
    t: string;
    topic?: string;
    seq?: number;
    prev?: number;
    digest?: string;
    granted?: string[];
    refused?: string[];
    cursors?: Record<string, number>;
  }) {
    switch (frame.t) {
      case "event": {
        if (!frame.topic) return;
        const at = this.cursors.get(frame.topic);
        // The chain does not line up: something was published that never reached us. Refetching on
        // the spot beats finding out whenever the next check happens to run.
        const hole = frame.prev != null && at != null && frame.prev !== at;
        if (frame.seq != null) this.advance(frame.topic, frame.seq);
        this.fire(frame.topic, hole ? "hole" : "event");
        return;
      }
      case "state": {
        if (!frame.topic || frame.digest == null) return;
        if (frame.seq != null) this.advance(frame.topic, frame.seq);
        this.check(frame.topic, frame.digest);
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

  /**
   * Compare what each subscriber holds against what the server says the answer is.
   *
   * A subscriber that holds nothing yet (null) is not a disagreement — it is mid-load, and telling
   * it to refetch would just fight with the fetch already in flight.
   */
  private check(topic: string, expected: string) {
    const set = this.listeners.get(topic);
    if (!set) return;
    for (const listener of [...set]) {
      const mine = listener.digest?.();
      if (mine == null || mine === expected) continue;
      this.mismatches += 1;
      console.warn(
        `updates: ${topic} should be "${expected}" but we hold "${mine}" — refetching; an event for this was never delivered`,
      );
      try {
        listener.onChange("mismatch");
      } catch {
        /* a listener that throws is that component's bug, not everyone else's */
      }
    }
  }

  private advance(topic: string, seq: number) {
    const at = this.cursors.get(topic);
    if (at == null || seq > at) this.cursors.set(topic, seq);
  }

  private fire(topic: string, reason: SyncReason) {
    const set = this.listeners.get(topic);
    if (!set) return;
    for (const listener of [...set]) {
      try {
        listener.onChange(reason);
      } catch {
        // A listener that throws is a bug in that component; it must not stop the others from
        // being told, or one broken pane would silently freeze the rest of the app.
      }
    }
  }
}
