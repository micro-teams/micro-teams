/*
 * The updates wire: the client half of backend/.../updates/UpdatesProtocol.kt, written by hand so
 * the two can be read side by side.
 *
 * ServerFrame — what the server says: event (a topic moved to seq), state (what a topic's data
 *   should digest to now), ack (which subscriptions were granted, with their cursors), gap (the
 *   server cannot catch this topic up), pong, err.
 * ClientFrame — what the client says: sub(topics, since), unsub(topics), ping.
 * parseFrame(text) → ServerFrame | null — anything not understood is null, never an error: this
 *   client may be older or newer than the server, and both have to keep working.
 * encodeFrame(frame) → the JSON text to send.
 *
 * Example: const frame = parseFrame(message.data); if (frame) store.handle(frame);
 *
 * The protocol says "topic X moved to cursor N" and never carries the thing that moved, so a frame
 * that is lost, duplicated or reordered costs one redundant refetch and can never put wrong data on
 * the screen.
 */

export type ServerFrame =
  | { t: "event"; topic: string; seq: number; prev: number | null; kind: string }
  | { t: "state"; topic: string; seq: number; digest: string }
  | { t: "ack"; granted: string[]; refused: string[]; cursors: Record<string, number> }
  | { t: "gap"; topic: string; seq: number | null }
  | { t: "pong" }
  | { t: "err"; message: string | null };

export type ClientFrame =
  | { t: "sub"; topics: string[]; since?: Record<string, number> }
  | { t: "unsub"; topics: string[] }
  | { t: "ping" };

const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function cursors(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (v && typeof v === "object") {
    for (const [k, n] of Object.entries(v)) if (typeof n === "number") out[k] = n;
  }
  return out;
}

export function parseFrame(text: string): ServerFrame | null {
  let v: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    v = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const topic = str(v.topic);
  switch (v.t) {
    case "event": {
      const seq = num(v.seq);
      if (topic === null || seq === null) return null;
      return { t: "event", topic, seq, prev: num(v.prev), kind: str(v.kind) ?? "" };
    }
    case "state": {
      const digest = str(v.digest);
      if (topic === null || digest === null) return null;
      return { t: "state", topic, seq: num(v.seq) ?? 0, digest };
    }
    case "ack":
      return { t: "ack", granted: strings(v.granted), refused: strings(v.refused), cursors: cursors(v.cursors) };
    case "gap":
      // seq may be absent: "refetch, and tell me where you land" from a server that just restarted.
      return topic === null ? null : { t: "gap", topic, seq: num(v.seq) };
    case "pong":
      return { t: "pong" };
    case "err":
      return { t: "err", message: str(v.message) };
    default:
      return null;
  }
}

export function encodeFrame(frame: ClientFrame): string {
  if (frame.t === "sub" && frame.since && Object.keys(frame.since).length === 0) {
    return JSON.stringify({ t: "sub", topics: frame.topics });
  }
  return JSON.stringify(frame);
}
