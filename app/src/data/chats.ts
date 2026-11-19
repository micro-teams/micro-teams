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
 * useThreadInfo(id) → { title(me), storedTitle, members, roleOf(userId), rename(title), add(userId),
 *   remove(userId), dissolve() } — a conversation's title and members, owners first, and what an
 *   owner or admin can do to it; title(me) is the stored title, or the other people's names when
 *   there is none. Each action refetches the conversation and the chat list.
 * useCreateChat() → create(title, memberIds?) → the new thread's id. parseMemberIds(raw) — "12, 34 56" as ids.
 * chatTitle(chat, me) — a group by its title, a one-to-one by the other person.
 *
 * ChatSummary, ThreadMember — the API's own shapes, named for the screens.
 * useFirstScreen(signedIn) → boolean — true once the first screen can be shown complete: signed
 *   out, or the chat list's first page has arrived or failed, or eight seconds have passed.
 *
 * Example:
 *   const { chats, loadMore } = useChats();
 *   chats.map((c) => <Row key={c.id} chat={c} />), and loadMore() when a scroll ends near the end
 *
 * Pages are fetched by cursor. The list and a conversation are fetched again when the updates
 * socket says their topic moved (and once on every reconnect and return to the foreground), and
 * they answer the server's periodic digest with what they hold. A conversation's newest page is
 * folded in by id: what it covers comes from the server, what it no longer covers (older history
 * the reader scrolled up to) is kept.
 */
import type { Message } from "./merge";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { Schema } from "../api/client";
import { mergeNewest, mergeOlder } from "./merge";
import { Outbox, type Pending } from "./outbox";
import { chatsTopic, threadDigest, threadTopic, useTopic } from "./topics";
import { useSession } from "./session";

export type ChatSummary = Schema["ChatSummary"];
export type { Message } from "./merge";
export type { Pending } from "./outbox";

const CHATS_PAGE = 50;
const MESSAGES_PAGE = 100;

export function chatTitle(chat: ChatSummary, me: number | undefined): string {
  if (chat.title) return chat.title;
  const others = chat.members.filter((m) => m.userId !== me);
  return others.length === 1 ? others[0].nickname : chat.members.map((m) => m.nickname).join(", ");
}

/**
 * Whether the first screen has what it shows: signed out, at once; signed in, once the chat list's
 * first page has arrived or failed — or after eight seconds, so a slow server never holds the app
 * behind its splash.
 */
export function useFirstScreen(signedIn: boolean): boolean {
  const queries = useQueryClient();
  const [late, setLate] = useState(false);
  const settled = useSyncExternalStore(
    (changed) => queries.getQueryCache().subscribe(changed),
    () => {
      const st = queries.getQueryState(["chats"]);
      return !!st && (st.status === "success" || st.status === "error");
    },
  );
  useEffect(() => {
    if (!signedIn) return;
    const t = setTimeout(() => setLate(true), 8000);
    return () => clearTimeout(t);
  }, [signedIn]);
  return !signedIn || settled || late;
}

export function useChats() {
  const { mt, user } = useSession();
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
  });
  // The server digests the number of conversations, which only the whole list can answer.
  useTopic(user ? chatsTopic(user.id) : null, () => q.refetch(), () =>
    q.data && !q.hasNextPage ? String(q.data.pages.reduce((n, p) => n + p.chats.length, 0)) : null,
  );
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

  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await mt!.GET("/chat/{id}/messages", { params: { path: { id }, query: { page_size: MESSAGES_PAGE } } });
        if (!alive || !data) return;
        setMessages((held) => mergeNewest(held, data.messages));
        outbox.reconcile(data.messages);
        setOlder((o) => (o === undefined ? (data.page.has_more ? (data.page.next_start ?? null) : null) : o));
        setLoaded(true);
        setError(null);
      } catch (e) {
        if (alive) setError(e);
      }
    })();
    return () => {
      alive = false;
    };
  }, [mt, id, outbox, tick]);
  useTopic(threadTopic(id), () => setTick((n) => n + 1), () => (loaded ? threadDigest(messages, MESSAGES_PAGE) : null));

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

const RANK = { OWNER: 0, ADMIN: 1, MEMBER: 2 } as const;

export function useThreadInfo(id: number) {
  const { mt } = useSession();
  const q = useQuery({
    queryKey: ["thread", id],
    queryFn: async () => (await mt!.GET("/chat/{id}", { params: { path: { id } } })).data!,
  });
  // The same array until the conversation changes, so the rows that take it are not redrawn.
  const members: ThreadMember[] = useMemo(() => [...(q.data?.members ?? [])].sort((a, b) => RANK[a.role] - RANK[b.role]), [q.data]);
  const queries = useQueryClient();
  const after = async (call: Promise<unknown>) => {
    await call;
    await Promise.all([queries.invalidateQueries({ queryKey: ["thread", id] }), queries.invalidateQueries({ queryKey: ["chats"] })]);
  };
  return {
    members,
    storedTitle: q.data?.thread.title ?? "",
    roleOf: (userId: number | undefined) => members.find((m) => m.userId === userId)?.role,
    rename: (title: string) => after(mt!.PATCH("/chat/{id}", { params: { path: { id } }, body: { title } })),
    add: (userId: number) => after(mt!.POST("/chat/{id}/members", { params: { path: { id } }, body: { userId } })),
    remove: (userId: number) => after(mt!.DELETE("/chat/{id}/members/{userId}", { params: { path: { id, userId } } })),
    dissolve: () => after(mt!.DELETE("/chat/{id}", { params: { path: { id } } })),
    title: (me: number | undefined) => {
      if (q.data?.thread.title) return q.data.thread.title;
      const others = members.filter((m) => m.userId !== me);
      return others.map((m) => m.nickname ?? `#${m.userId}`).join(", ");
    },
  };
}

export function useCreateChat() {
  const { mt } = useSession();
  const queries = useQueryClient();
  const m = useMutation({
    mutationFn: async ({ title, memberIds }: { title: string; memberIds: number[] }) => {
      const { data } = await mt!.POST("/chat", { body: { title, memberIds } });
      return data!.id;
    },
    onSuccess: () => queries.invalidateQueries({ queryKey: ["chats"] }),
  });
  return (title: string, memberIds: number[] = []) => m.mutateAsync({ title, memberIds });
}

/** "12, 34 56" as ids. Anything that is not a number is dropped: a stray comma is not worth refusing. */
export function parseMemberIds(raw: string): number[] {
  return raw
    .split(/[\s,，]+/)
    .map((p) => Number(p.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}
