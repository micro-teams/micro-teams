// One open conversation: the messages, how they arrive, and everything about where the list sits.
//
// "Where the list sits" belongs here and not in a layout because it is not decoration — it is the
// pagination trigger, the pin-to-bottom rule, and the scroll-position restore that keeps loading
// older messages from throwing the reader somewhere else. Get any of those wrong and the list still
// renders perfectly; it just behaves badly. Both shells had their own copy of all of it.
//
// The caller attaches `listRef` and `onScroll` to whatever element scrolls, and renders `messages`
// however it likes. That is the whole seam.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Message } from "@/api";
import { chatApi, mtCall } from "@/lib/mtApi";
import { getCache, setCache } from "@/lib/cache";
import { errMsg } from "@/hooks/useAsync";
import { useOutbox, type Pending } from "@/hooks/useOutbox";
import { mergeNewestPage, mergeOlderPage } from "@/features/chats/merge";
import { useUpdatesTopic } from "@/hooks/useUpdates";
import { threadTopic } from "@/lib/updates/topics";

/** Messages per request — the newest page (polled) and each older page walked backwards. */
const PAGE_SIZE = 100;

/** Within this many px of the end counts as "at the bottom" — a new message may scroll us. */
const AT_BOTTOM_PX = 100;
/** Scrolling within this many px of the top asks for an older page. */
const NEAR_TOP_PX = 200;

export interface ThreadMessages {
  messages: Message[];
  loading: boolean;
  loadingOlder: boolean;
  error: string | null;
  pending: Pending[];
  retry: (clientToken: string) => void;
  discard: (clientToken: string) => void;
  /** Attach to the scrolling element. */
  listRef: React.RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  /** Enqueue a message. Delivery (and retrying) is the outbox's problem from here. */
  send: (content: string) => void;
}

export function useThreadMessages(
  threadId: number,
  { onDiscard }: { onDiscard?: (content: string) => void } = {},
): ThreadMessages {
  const msgKey = `messages:${threadId}`;
  const [messages, setMessages] = useState<Message[]>(
    () => getCache<Message[]>(msgKey) ?? [],
  );
  const [loading, setLoading] = useState(
    () => getCache<Message[]>(msgKey) == null,
  );
  const [error, setError] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  // Set by the effect below, so the push channel can trigger the very same fetch. A ref rather than
  // a callback dependency: the fetch closes over this thread's cursors and must not be rebuilt.
  const refetch = useRef<(() => void) | null>(null);

  // Messages the user has sent that the server has not confirmed yet. The outbox keeps retrying
  // them (and survives a reload), so a bad network never turns into a lost message or a scary
  // error — see useOutbox.
  const outbox = useOutbox(threadId, {
    onSent: (msg) => {
      setMessages((prev) =>
        prev.some((m) => m.id === msg.id) ? prev : [...prev, msg],
      );
      const cached = getCache<Message[]>(msgKey) ?? [];
      if (!cached.some((m) => m.id === msg.id))
        setCache(msgKey, [...cached, msg]);
    },
    // A message the user gave up on goes back to the composer rather than vanishing.
    onDiscard,
  });

  // Whether the view is pinned to the bottom. Starts true (a fresh thread opens at the newest
  // message); flips off once the user scrolls up to read history, so the poll never yanks them
  // back down.
  const atBottomRef = useRef(true);
  // Everything the pane currently holds, newest page + any older pages loaded by scrolling up.
  // Kept in a ref as well as state because the poll folds into it.
  const allRef = useRef<Message[]>([]);
  // Cursor for the next OLDER page, and whether one exists. While no older page has been loaded
  // these track the newest page (its nextStart moves as new messages arrive); after the first
  // load they only advance backwards.
  const olderCursor = useRef<number | undefined>(undefined);
  const hasOlder = useRef(false);
  const loadingOlderRef = useRef(false);
  const walkedBack = useRef(false);

  useEffect(() => {
    let active = true;
    // Paint the cached messages for this thread at once (stale-while-revalidate); only spin when
    // we have nothing cached to show.
    const cached = getCache<Message[]>(msgKey);
    allRef.current = cached ?? [];
    setMessages(allRef.current);
    setLoading(cached == null);
    atBottomRef.current = true;
    olderCursor.current = undefined;
    hasOlder.current = false;
    walkedBack.current = false;
    const fetchOnce = () =>
      mtCall(chatApi().listMessages({ id: threadId, pageSize: PAGE_SIZE }))
        .then((res) => {
          if (!active) return;
          // Anything the server already has stops being pending — matched by clientToken, so a
          // send whose response was lost is recognised rather than sent twice.
          outbox.reconcile(res.messages);
          if (!walkedBack.current) {
            hasOlder.current = res.page.hasMore;
            olderCursor.current = res.page.nextStart;
          }
          allRef.current = mergeNewestPage(allRef.current, res.messages);
          setMessages(allRef.current);
          setCache(msgKey, allRef.current.slice(-PAGE_SIZE));
        })
        .catch((err: unknown) => active && setError(errMsg(err)))
        .finally(() => active && setLoading(false));
    refetch.current = () => void fetchOnce();
    void fetchOnce();
    return () => {
      active = false;
      refetch.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  // The 4s poll used to live here. What replaced it is not "the same thing over a socket": the
  // server says when this thread moved, AND periodically says what the thread should look like, so
  // a message that failed to publish an event is now reported by name instead of being silently
  // repaired by the next tick.
  //
  // The digest mirrors ThreadQuery.digest: the newest id and how many messages, over the newest
  // PAGE_SIZE — the same window on both sides, which is the only reason the two are comparable at
  // all. (Scrolling up loads older pages, so what we hold can be larger than that window; the
  // digest is taken over the newest slice of it.) Edits are not covered — see ThreadQuery.
  useUpdatesTopic(
    threadTopic(threadId),
    () => refetch.current?.(),
    () => {
      const held = allRef.current;
      if (held.length === 0) return loading ? null : "empty";
      const page = held.slice(-PAGE_SIZE);
      return `${page[page.length - 1].id}:${page.length}`;
    },
  );

  // Scrolling up past the top of what we hold walks the cursor backwards. The list grows upward,
  // so the scroll position is restored by distance-from-the-bottom — otherwise inserting above the
  // viewport would jump the reader away from where they were.
  const loadOlder = useCallback(async () => {
    if (loadingOlderRef.current || !hasOlder.current) return;
    const cursor = olderCursor.current;
    if (cursor == null) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    const fromBottom = listRef.current
      ? listRef.current.scrollHeight - listRef.current.scrollTop
      : 0;
    try {
      const res = await mtCall(
        chatApi().listMessages({
          id: threadId,
          pageStart: cursor,
          pageSize: PAGE_SIZE,
        }),
      );
      walkedBack.current = true;
      hasOlder.current = res.page.hasMore;
      olderCursor.current = res.page.nextStart;
      allRef.current = mergeOlderPage(allRef.current, res.messages);
      setMessages(allRef.current);
      requestAnimationFrame(() => {
        const el = listRef.current;
        if (el) el.scrollTop = el.scrollHeight - fromBottom;
      });
    } catch (err: unknown) {
      setError(errMsg(err));
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [threadId]);

  const onScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    atBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < AT_BOTTOM_PX;
    if (el.scrollTop < NEAR_TOP_PX) void loadOlder();
  }, [loadOlder]);

  // Auto-scroll only when a NEW message arrives AND the view is at the bottom (or the user just
  // sent one). Keying on the last message id — not the whole array — means a poll that returns
  // nothing new never re-scrolls, so reading a tall last message is never interrupted.
  //
  // Scrolling the container itself, not a sentinel's scrollIntoView(): the sentinel's bottom edge
  // is above the list's own bottom padding, so aligning to it left that padding unscrolled and the
  // thread opened a few pixels short of the end. (T-072)
  const lastMessageId = messages.length ? messages[messages.length - 1].id : 0;
  useEffect(() => {
    const el = listRef.current;
    if (lastMessageId && atBottomRef.current && el)
      el.scrollTop = el.scrollHeight;
  }, [lastMessageId]);

  const send = useCallback(
    (content: string) => {
      const clean = content.trim();
      if (!clean) return;
      // Handed to the outbox, which owns delivery from here: it retries until the server takes it.
      outbox.enqueue(clean);
      atBottomRef.current = true;
    },
    [outbox],
  );

  return {
    messages,
    loading,
    loadingOlder,
    error,
    pending: outbox.pending,
    retry: outbox.retry,
    discard: outbox.discard,
    listRef,
    onScroll,
    send,
  };
}
