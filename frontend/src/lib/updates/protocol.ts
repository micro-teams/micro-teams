// The updates wire, written by hand.
//
// Not generated: this is not an OpenAPI surface, and the one thing this file has to do is stay
// readable next to backend/src/main/kotlin/app/microteams/updates/UpdatesProtocol.kt. Two hand-
// written halves that can be diffed by eye beat a generator that only covers one of them.
//
// The protocol says "topic X moved to cursor N" and never sends the thing that moved. So a frame
// that is lost, duplicated or arrives out of order costs one redundant refetch and can never put
// wrong data on the screen. Everything downstream is built on that being true — nothing here is
// allowed to become the only way to learn something.

export const UPDATES_PROTOCOL_VERSION = 1;

/** Server -> browser. Anything with an unrecognised `t` must be ignored in silence. */
export type ServerFrame =
  | {
      t: "event";
      v?: number;
      topic: string;
      seq: number;
      /**
       * Where the topic stood before this event. Message ids are not contiguous, so this is the
       * only way to notice a frame that never arrived — without it, 9134 looks the same whether or
       * not 9120 happened. Absent on the first thing ever said about a topic.
       */
      prev?: number;
      kind: string;
    }
  | {
      /** What the query's result should look like right now, asked of the data source. */
      t: "state";
      v?: number;
      topic: string;
      seq: number;
      digest: string;
    }
  | {
      t: "ack";
      v?: number;
      granted: string[];
      refused: string[];
      cursors: Record<string, number>;
    }
  | { t: "gap"; v?: number; topic: string; seq?: number }
  | { t: "pong"; v?: number }
  | { t: "err"; v?: number; message?: string };

/** Browser -> server. */
export type ClientFrame =
  | { t: "sub"; topics: string[]; since?: Record<string, number> }
  | { t: "unsub"; topics: string[] }
  | { t: "ping" };

/**
 * Parse a frame off the wire. Returns null for anything we do not understand — which is a normal
 * event, not an error: this client can be older than the server it is talking to (a cached Service
 * Worker) and newer than it too (deploy order), and both have to keep working.
 */
export function parseFrame(raw: string): ServerFrame | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const frame = value as { t?: unknown };
  switch (frame.t) {
    case "event": {
      const f = value as {
        topic?: unknown;
        seq?: unknown;
        prev?: unknown;
        kind?: unknown;
      };
      if (typeof f.topic !== "string" || typeof f.seq !== "number") return null;
      return {
        t: "event",
        topic: f.topic,
        seq: f.seq,
        prev: typeof f.prev === "number" ? f.prev : undefined,
        kind: typeof f.kind === "string" ? f.kind : "",
      };
    }
    case "state": {
      const f = value as { topic?: unknown; seq?: unknown; digest?: unknown };
      if (typeof f.topic !== "string" || typeof f.digest !== "string")
        return null;
      return {
        t: "state",
        topic: f.topic,
        seq: typeof f.seq === "number" ? f.seq : 0,
        digest: f.digest,
      };
    }
    case "ack": {
      const f = value as {
        granted?: unknown;
        refused?: unknown;
        cursors?: unknown;
      };
      return {
        t: "ack",
        granted: Array.isArray(f.granted) ? (f.granted as string[]) : [],
        refused: Array.isArray(f.refused) ? (f.refused as string[]) : [],
        cursors:
          typeof f.cursors === "object" && f.cursors !== null
            ? (f.cursors as Record<string, number>)
            : {},
      };
    }
    case "gap": {
      const f = value as { topic?: unknown; seq?: unknown };
      if (typeof f.topic !== "string") return null;
      // seq may legitimately be absent: "refetch, and tell me where you land" is a real answer
      // from a server that has just restarted and knows it knows nothing.
      return {
        t: "gap",
        topic: f.topic,
        seq: typeof f.seq === "number" ? f.seq : undefined,
      };
    }
    case "pong":
      return { t: "pong" };
    case "err": {
      const f = value as { message?: unknown };
      return {
        t: "err",
        message: typeof f.message === "string" ? f.message : undefined,
      };
    }
    default:
      return null;
  }
}
