// The outbox: a message you sent is sent, even over a bad network.
//
// Sending used to be one attempt. Any hiccup — a dropped packet, a tunnel switching over, a phone
// waking from sleep — surfaced as an error the user had to act on, and the bubble they had already
// seen disappeared. That is the wrong bargain: the network being briefly unreliable is normal, and
// the user should not be the retry mechanism.
//
// So a send is queued instead of attempted: the queue is persisted (localStorage, scoped to the
// signed-in user by lib/cache), retried with backoff until it succeeds, and only surfaced as a
// failure when the server has actually REFUSED it (not a member any more, thread gone, content
// rejected) — which no amount of retrying would fix. Until then the bubble stays, marked as sending,
// and nothing red appears: a message still on its way has not failed, and saying it has is the
// "wrong presentation" this is meant to avoid.
//
// Retrying a write is only safe if the server can recognise the retry, because the dangerous case is
// invisible from here: the request arrived and was stored, but the response was lost. Each queued
// message therefore carries a clientToken, and the server returns the stored message rather than
// creating a second one (see MessageService.postMessage). That token is also how a queued message is
// matched to the confirmed one — by identity, not by guessing from content.
//
// Not covered, deliberately: closing the tab within the second or so before the first attempt
// finishes. The queue survives a reload, so this is the only gap, and closing an app mid-action is
// not a promise any client can keep.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Message } from "@/api";
import { chatApi, mtCall, MtError } from "@/lib/mtApi";
import { getCache, setCache } from "@/lib/cache";

/** A message the user has sent that the server has not yet confirmed. */
export type Pending = {
  clientToken: string;
  content: string;
  createdAt: string;
  /** `sending` while attempts continue; `failed` only when the server refused it. */
  state: "sending" | "failed";
  attempts: number;
  error?: string;
};

/** Backoff between attempts. Capped: a long outage should not stretch to hours of silence. */
const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000, 30000];

const outboxKey = (threadId: number) => `outbox:${threadId}`;

/**
 * A refused send is one the server answered with a verdict. 4xx means "not going to work" — no
 * membership, no thread, invalid content — so retrying is pointless and the user must be told. A
 * 5xx, a timeout or a dead network is not a verdict, so it is retried silently.
 *
 * 408 and 429 are the exceptions among 4xx: both explicitly mean "ask again later".
 */
function isRefusal(err: unknown): boolean {
  if (!(err instanceof MtError)) return false; // no response at all: the network, not the server
  if (err.status === 408 || err.status === 429) return false;
  return err.status >= 400 && err.status < 500;
}

export function useOutbox(
  threadId: number,
  {
    onSent,
    onDiscard,
  }: {
    /** A confirmed message, so the view can show it without waiting for the next poll. */
    onSent: (message: Message) => void;
    /** A failed message the user dropped — its text, so the composer can offer it back. */
    onDiscard?: (content: string) => void;
  },
) {
  const [pending, setPending] = useState<Pending[]>(
    () => getCache<Pending[]>(outboxKey(threadId)) ?? [],
  );
  // The queue is also read from timers and event listeners, which must see the current value
  // without being re-created on every change.
  const queueRef = useRef<Pending[]>(pending);
  const timerRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const onSentRef = useRef(onSent);
  onSentRef.current = onSent;

  const write = useCallback(
    (next: Pending[]) => {
      queueRef.current = next;
      setPending(next);
      // Persisted per thread: a reload, a tab switch or the OS reclaiming the page all keep it.
      setCache(outboxKey(threadId), next);
    },
    [threadId],
  );

  // One attempt at the head of the queue, then schedule the next. Strictly serial per thread, so
  // messages keep the order they were typed in even when the first one is slow.
  const pump = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (inFlightRef.current) return;
    const head = queueRef.current.find((p) => p.state === "sending");
    if (!head) return;

    inFlightRef.current = true;
    void mtCall(
      chatApi().postMessage({
        id: threadId,
        postMessageRequest: {
          content: head.content,
          clientToken: head.clientToken,
        },
      }),
    )
      .then((msg) => {
        // Confirmed: drop it from the queue and hand the real message to the view.
        write(
          queueRef.current.filter((p) => p.clientToken !== head.clientToken),
        );
        onSentRef.current(msg);
      })
      .catch((err: unknown) => {
        const refused = isRefusal(err);
        write(
          queueRef.current.map((p) =>
            p.clientToken === head.clientToken
              ? {
                  ...p,
                  attempts: p.attempts + 1,
                  state: refused ? "failed" : "sending",
                  error: refused
                    ? err instanceof Error
                      ? err.message
                      : String(err)
                    : undefined,
                }
              : p,
          ),
        );
      })
      .finally(() => {
        inFlightRef.current = false;
        const next = queueRef.current.find((p) => p.state === "sending");
        if (!next) return;
        const wait = BACKOFF_MS[Math.min(next.attempts, BACKOFF_MS.length - 1)];
        timerRef.current = window.setTimeout(
          pump,
          next.attempts === 0 ? 0 : wait,
        );
      });
  }, [threadId, write]);

  // Swap queues when the thread changes, and start sending whatever is already waiting (from a
  // previous visit or a reload).
  useEffect(() => {
    const stored = getCache<Pending[]>(outboxKey(threadId)) ?? [];
    queueRef.current = stored;
    setPending(stored);
    pump();
    return () => {
      if (timerRef.current != null) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  // Don't sit out a backoff when the situation has visibly changed: coming back online, or the tab
  // becoming visible again, is the moment a stuck message is most likely to go through.
  useEffect(() => {
    const kick = () => pump();
    window.addEventListener("online", kick);
    document.addEventListener("visibilitychange", kick);
    window.addEventListener("focus", kick);
    return () => {
      window.removeEventListener("online", kick);
      document.removeEventListener("visibilitychange", kick);
      window.removeEventListener("focus", kick);
    };
  }, [pump]);

  /** Queue a message. It will be delivered; the caller can clear its input immediately. */
  const enqueue = useCallback(
    (content: string) => {
      const entry: Pending = {
        clientToken:
          globalThis.crypto?.randomUUID?.() ??
          `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        content,
        createdAt: new Date().toISOString(),
        state: "sending",
        attempts: 0,
      };
      write([...queueRef.current, entry]);
      pump();
    },
    [pump, write],
  );

  /** Try a refused message again — the user's call, e.g. after they rejoined the group. */
  const retry = useCallback(
    (clientToken: string) => {
      write(
        queueRef.current.map((p) =>
          p.clientToken === clientToken
            ? { ...p, state: "sending", attempts: 0, error: undefined }
            : p,
        ),
      );
      pump();
    },
    [pump, write],
  );

  /** Give up on a message: it leaves the thread, and its text goes back to the composer. */
  const discard = useCallback(
    (clientToken: string) => {
      const gone = queueRef.current.find((p) => p.clientToken === clientToken);
      write(queueRef.current.filter((p) => p.clientToken !== clientToken));
      if (gone && onDiscard) onDiscard(gone.content);
    },
    [onDiscard, write],
  );

  /**
   * Drop queued messages the server has already stored. Called with each fetched page: a message
   * whose token comes back is confirmed, which covers the case that made retrying risky — the
   * response to a successful send was lost, so this client never saw its own message arrive.
   */
  const reconcile = useCallback(
    (serverMessages: Message[]) => {
      const seen = new Set(
        serverMessages.map((m) => m.clientToken).filter(Boolean) as string[],
      );
      if (seen.size === 0) return;
      const next = queueRef.current.filter((p) => !seen.has(p.clientToken));
      if (next.length !== queueRef.current.length) write(next);
    },
    [write],
  );

  return { pending, enqueue, retry, discard, reconcile };
}
