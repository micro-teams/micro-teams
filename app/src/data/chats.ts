/*
 * The chat list and one conversation: what a screen reads, never how it is fetched.
 *
 * useChats() → { chats, loadMore(), hasMore, loading, error } — the caller's conversations, most
 *   recent activity first; loadMore() asks the same live request for more of them.
 * useThread(id) → { messages, loaded, pending, loadOlder(), hasOlder, loadingOlder, error, send(text),
 *   retry(token), discard(token) } — one conversation, oldest first, including the JOINED and LEFT
 *   lines; loadOlder() asks the same live request for a longer stretch of history. Sending goes
 *   through the conversation's Outbox (data/outbox.ts): pending is what it still owes, retry sends
 *   one again now, discard gives its text back.
 * useThreadInfo(id) → { members, teams, isMember, storedTitle, title(me), rename(title), add(userId),
 *   remove(userId), join(), leave(me), dissolve() } — a conversation's title, members and teams,
 *   and what anyone in it can do; a reader who is not a member can join. title(me) is the stored
 *   title, or the other people's names when there is none.
 * useCreateChat() → create(title, memberIds?) → the new thread's id. parseMemberIds(raw) — "12, 34 56" as ids.
 * chatTitle(chat, me) — a group by its title, a one-to-one by the other person.
 *
 * ChatSummary, ThreadMember — the API's own shapes, named for the screens.
 * useFirstScreen(signedIn) → boolean — true once the first screen can be shown: signed out, or the
 *   chat list's first answer has arrived (kept from the last run counts), or eight seconds passed.
 *
 * Example:
 *   const { chats, loadMore } = useChats();
 *   chats.map((c) => <Row key={c.id} chat={c} />), and loadMore() when a scroll ends near the end
 *
 * Everything here is a live request (data/live.ts): the server answers again whenever what it
 * returns changes, so nothing here refetches or patches after a write.
 */
import { useEffect, useMemo, useState } from "react";
import type { Schema } from "../api/client";
import { livePath, useLive } from "./live";
import { Outbox, type Pending } from "./outbox";
import { useSession } from "./session";

export type ChatSummary = Schema["ChatSummary"];
export type Message = Schema["Message"];
export type { Pending } from "./outbox";

const CHATS_STEP = 50;
const MESSAGES_STEP = 100;

export function chatTitle(chat: ChatSummary, me: number | undefined): string {
  if (chat.title) return chat.title;
  const others = chat.members.filter((m) => m.userId !== me);
  return others.length === 1 ? others[0].nickname : chat.members.map((m) => m.nickname).join(", ");
}

const chatsPath = (n: number) => livePath("/chat", { page_size: n, queryIsMemberAgent: true });

/**
 * Whether the first screen has what it shows: signed out, at once; signed in, once the chat list
 * has an answer (a kept one counts) — or after eight seconds, so a slow server never holds the app
 * behind its splash.
 */
export function useFirstScreen(signedIn: boolean): boolean {
  const [late, setLate] = useState(false);
  const { loaded } = useLive<ListChats>(signedIn ? chatsPath(CHATS_STEP) : null);
  useEffect(() => {
    if (!signedIn) return;
    const t = setTimeout(() => setLate(true), 8000);
    return () => clearTimeout(t);
  }, [signedIn]);
  return !signedIn || loaded || late;
}

type ListChats = Schema["ListChatsResponse"];
type ListMessages = Schema["ListMessagesResponse"];

export function useChats() {
  const [n, setN] = useState(CHATS_STEP);
  const { data, loaded, status } = useLive<ListChats>(chatsPath(n));
  const hasMore = !!data?.page.has_more;
  return {
    chats: data?.chats ?? [],
    loadMore: () => {
      if (hasMore) setN((x) => x + CHATS_STEP);
    },
    hasMore,
    loading: !loaded,
    error: status !== undefined && status !== 200 ? new Error(`chat list: ${status}`) : null,
  };
}

export function useThread(id: number) {
  const { mt } = useSession();
  const [n, setN] = useState(MESSAGES_STEP);
  const { data, loaded, status } = useLive<ListMessages>(livePath(`/chat/${id}/messages`, { page_size: n }));
  const messages: Message[] = useMemo(() => data?.messages ?? [], [data]);

  const outbox = useMemo(
    () =>
      new Outbox(
        id,
        async (content, clientToken) =>
          (await mt!.POST("/chat/{id}/messages", { params: { path: { id } }, body: { content, clientToken } })).data!,
        () => setPending(outbox.pending),
      ),
    [mt, id],
  );
  const [pending, setPending] = useState<readonly Pending[]>(() => outbox.pending);
  useEffect(() => () => outbox.dispose(), [outbox]);
  useEffect(() => {
    if (data) outbox.reconcile(data.messages);
  }, [outbox, data]);

  const hasOlder = !!data?.page.has_more;
  return {
    messages,
    loaded,
    pending,
    loadOlder: () => {
      if (hasOlder) setN((x) => x + MESSAGES_STEP);
    },
    hasOlder,
    loadingOlder: hasOlder && messages.length < n && !!data && data.messages.length < n,
    error: status !== undefined && status !== 200 ? new Error(`conversation: ${status}`) : null,
    send: (text: string) => outbox.enqueue(text),
    retry: (clientToken: string) => outbox.retry(clientToken),
    discard: (clientToken: string) => outbox.discard(clientToken),
  };
}

export type ThreadMember = Schema["ThreadMember"];
type ThreadDetail = Schema["ThreadDetail"];

export function useThreadInfo(id: number) {
  const { mt } = useSession();
  const { data } = useLive<ThreadDetail>(`/chat/${id}`);
  const members: ThreadMember[] = useMemo(() => data?.members ?? [], [data]);
  return {
    members,
    teams: data?.teams ?? [],
    isMember: data?.isMember ?? true,
    storedTitle: data?.thread.title ?? "",
    rename: (title: string) => mt!.PATCH("/chat/{id}", { params: { path: { id } }, body: { title } }),
    add: (userId: number) => mt!.POST("/chat/{id}/members", { params: { path: { id } }, body: { userId } }),
    remove: (userId: number) => mt!.DELETE("/chat/{id}/members/{userId}", { params: { path: { id, userId } } }),
    join: () => mt!.POST("/chat/{id}/join", { params: { path: { id } } }),
    leave: (me: number) => mt!.DELETE("/chat/{id}/members/{userId}", { params: { path: { id, userId: me } } }),
    dissolve: () => mt!.DELETE("/chat/{id}", { params: { path: { id } } }),
    title: (me: number | undefined) => {
      if (data?.thread.title) return data.thread.title;
      const others = members.filter((m) => m.userId !== me);
      return others.map((m) => m.nickname ?? `#${m.userId}`).join(", ");
    },
  };
}

export function useCreateChat() {
  const { mt } = useSession();
  return async (title: string, memberIds: number[] = []) => {
    const { data } = await mt!.POST("/chat", { body: { title, memberIds } });
    return data!.id;
  };
}

/** "12, 34 56" as ids. Anything that is not a number is dropped: a stray comma is not worth refusing. */
export function parseMemberIds(raw: string): number[] {
  return raw
    .split(/[\s,，]+/)
    .map((p) => Number(p.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}
