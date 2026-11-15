/*
 * The chat list and one conversation, as queries: what a screen reads, never how it is fetched.
 *
 * useChats() → { chats, loadMore(), hasMore, loading, error, refresh() } — every page of the
 *   caller's conversations, most recent activity first. loadMore() fetches the next page; it is a
 *   no-op while one is in flight or when there is none.
 * useThread(id) → { messages, loaded, pending, loadOlder(), hasOlder, loadingOlder, error, send(text),
 *   retry(token), discard(token) } — one conversation, oldest first; loaded turns true once the
 *   newest page has arrived. Sending goes through the conversation's Outbox (data/outbox.ts):
 *   pending is what it still owes, retry sends one again now, discard gives its text back.
 * useThreadInfo(id) → { title(me), members } — a conversation's title and members; title(me) is
 *   the stored title, or the other people's names when there is none.
 * useCreateChat() → create(title) → the new thread's id.
 * chatTitle(chat, me) — a group by its title, a one-to-one by the other person.
 *
 * Example:
 *   const { chats, loadMore } = useChats();
 *   <FlashList data={chats} onEndReached={loadMore} ... />
 *
 * Pages are fetched by cursor, and the newest page of a conversation is fetched again every few
 * seconds and folded in by id: what it covers comes from the server, what it no longer covers
 * (older history the reader scrolled up to) is kept.
 */
import type { Message } from "./merge";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { Schema } from "../api/client";
import { mergeNewest, mergeOlder } from "./merge";
import { Outbox, type Pending } from "./outbox";
import { useSession } from "./session";

export type ChatSummary = Schema["ChatSummary"];
export type { Message } from "./merge";
export type { Pending } from "./outbox";

const CHATS_PAGE = 50;
const MESSAGES_PAGE = 100;
const NEWEST_EVERY_MS = 3000;

export function chatTitle(chat: ChatSummary, me: number | undefined): string {
  if (chat.title) return chat.title;
  const others = chat.members.filter((m) => m.userId !== me);
  return others.length === 1 ? others[0].nickname : chat.members.map((m) => m.nickname).join("、");
}

export function useChats() {
  const { mt } = useSession();
  const q = useInfiniteQuery({
    queryKey: ["chats"],
    initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam }) => {
      const { data } = await mt!.GET("/chat", {
        params: { query: { page_size: CHATS_PAGE, page_start: pageParam, queryIsMemberAgent: true } },
      });
      return data!;
    },
    getNextPageParam: (last) => (last.page.has_more ? last.page.next_start : undefined),
    refetchInterval: 10_000,
  });
  return {
    chats: q.data?.pages.flatMap((p) => p.chats) ?? [],
    loadMore: () => {
      if (q.hasNextPage && !q.isFetchingNextPage) q.fetchNextPage();
    },
    hasMore: q.hasNextPage,
    loading: q.isPending,
    error: q.error,
    refresh: () => q.refetch(),
  };
}


export function useThread(id: number) {
  const { mt } = useSession();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [older, setOlder] = useState<number | null | undefined>(undefined);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const outbox = useMemo(
    () =>
      new Outbox(
        id,
        async (content, clientToken) =>
          (await mt!.POST("/chat/{id}/messages", { params: { path: { id } }, body: { content, clientToken } })).data!,
        (sent) => {
          if (sent) setMessages((held) => mergeNewest(held, [sent]));
          setPending(outbox.pending);
        },
      ),
    [mt, id],
  );
  const [pending, setPending] = useState<readonly Pending[]>(() => outbox.pending);
  useEffect(() => () => outbox.dispose(), [outbox]);

  useEffect(() => {
    let alive = true;
    let first = true;
    const tick = async () => {
      try {
        const { data } = await mt!.GET("/chat/{id}/messages", { params: { path: { id }, query: { page_size: MESSAGES_PAGE } } });
        if (!alive || !data) return;
        setMessages((held) => mergeNewest(held, data.messages));
        outbox.reconcile(data.messages);
        if (first) setOlder(data.page.has_more ? (data.page.next_start ?? null) : null);
        setLoaded(true);
        first = false;
        setError(null);
      } catch (e) {
        if (alive) setError(e);
      }
    };
    tick();
    const t = setInterval(tick, NEWEST_EVERY_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [mt, id, outbox]);

  const loadOlder = async () => {
    if (older == null || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const { data } = await mt!.GET("/chat/{id}/messages", {
        params: { path: { id }, query: { page_size: MESSAGES_PAGE, page_start: older } },
      });
      if (data) {
        setMessages((held) => mergeOlder(held, data.messages));
        setOlder(data.page.has_more ? (data.page.next_start ?? null) : null);
      }
    } catch (e) {
      setError(e);
    }
    setLoadingOlder(false);
  };

  return {
    messages,
    loaded,
    pending,
    loadOlder,
    hasOlder: older !== null,
    loadingOlder,
    error,
    send: (text: string) => outbox.enqueue(text),
    retry: (clientToken: string) => outbox.retry(clientToken),
    discard: (clientToken: string) => outbox.discard(clientToken),
  };
}

export type ThreadMember = Schema["ThreadMember"];

export function useThreadInfo(id: number) {
  const { mt } = useSession();
  const q = useQuery({
    queryKey: ["thread", id],
    queryFn: async () => (await mt!.GET("/chat/{id}", { params: { path: { id } } })).data!,
  });
  const members: ThreadMember[] = q.data?.members ?? [];
  return {
    members,
    title: (me: number | undefined) => {
      if (q.data?.thread.title) return q.data.thread.title;
      const others = members.filter((m) => m.userId !== me);
      return others.map((m) => m.nickname ?? `#${m.userId}`).join("、");
    },
  };
}

export function useCreateChat() {
  const { mt } = useSession();
  const queries = useQueryClient();
  const m = useMutation({
    mutationFn: async (title: string) => {
      const { data } = await mt!.POST("/chat", { body: { title } });
      return data!.id;
    },
    onSuccess: () => queries.invalidateQueries({ queryKey: ["chats"] }),
  });
  return m.mutateAsync;
}
