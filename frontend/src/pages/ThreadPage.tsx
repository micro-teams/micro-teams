import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useNavigate, useParams } from "react-router";
import { MoreHorizontal } from "lucide-react";
import type { Message, ThreadMember } from "@/api";
import { chatApi, mtCall } from "@/lib/mtApi";
import { getCache, setCache } from "@/lib/cache";
import { mergeNewestPage, mergeOlderPage } from "@/lib/messages";
import { useAuth } from "@/hooks/useAuth";
import { useAsync, errMsg } from "@/hooks/useAsync";
import { PageHeader } from "@/components/PageHeader";
import { UserAvatar } from "@/components/UserAvatar";
import { useAgentPresence } from "@/hooks/useAgentPresence";
import { useOutbox, type Pending } from "@/hooks/useOutbox";
import { Textarea } from "@/components/ui/textarea";
import { Clock } from "lucide-react";
import { Loading } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";

// WeChat-ish bubble colours (recognisable green for your own messages).
const OWN_BG = "#95ec69";
const OWN_FG = "#111111";
const OTHER_BG = "#2c2c2e";
const OTHER_FG = "#ffffff";

// Messages per request — both for the newest page (polled) and for each older page
// walked backwards through history.
const PAGE_SIZE = 100;

export function ThreadPage() {
  const { threadId: threadIdParam } = useParams();
  const threadId = Number(threadIdParam);
  const navigate = useNavigate();
  const { user } = useAuth();
  const rootRef = useRef<HTMLDivElement>(null);

  const detail = useAsync(
    () => mtCall(chatApi().getThread({ id: threadId })),
    [threadId],
    `thread:${threadId}`,
  );

  // Keep the thread sized to the *visible* viewport so the composer stays above
  // the on-screen keyboard, which overlays (rather than shrinks) the layout on
  // mobile. Covers iOS via visualViewport and reinforces the Android-only
  // interactive-widget=resizes-content viewport hint in index.html.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const apply = () => {
      if (rootRef.current) rootRef.current.style.height = `${vv.height}px`;
    };
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
    };
  }, []);

  return (
    <div ref={rootRef} className="flex h-svh flex-col bg-[#111111]">
      <PageHeader
        title={
          <span className="block text-center">
            {detail.data?.thread.title || `thread #${threadId}`}
          </span>
        }
        back
        backFallback="/chats"
        actions={
          <button
            type="button"
            onClick={() => navigate(`/chats/${threadId}/info`)}
            className="text-foreground hover:bg-accent flex size-8 items-center justify-center rounded-md"
            aria-label="chat info"
          >
            <MoreHorizontal className="size-5" />
          </button>
        }
      />

      <MessageList
        threadId={threadId}
        currentUserId={user?.id}
        members={detail.data?.members ?? []}
      />
    </div>
  );
}

function MessageList({
  threadId,
  currentUserId,
  members,
}: {
  threadId: number;
  currentUserId?: number;
  /** The thread's members, so each message can paint its author's name and avatar. */
  members: ThreadMember[];
}) {
  const memberById = useMemo(
    () => new Map(members.map((m) => [m.userId, m])),
    [members],
  );
  const msgKey = `messages:${threadId}`;
  const [messages, setMessages] = useState<Message[]>(
    () => getCache<Message[]>(msgKey) ?? [],
  );
  const [loading, setLoading] = useState(
    () => getCache<Message[]>(msgKey) == null,
  );
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
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
    onDiscard: (content) => setText((t) => (t.trim() ? t : content)),
  });
  // Whether the view is pinned to the bottom. Starts true (a fresh thread opens
  // at the newest message); flips off once the user scrolls up to read history,
  // so the 4s poll never yanks them back down.
  const atBottomRef = useRef(true);
  // Everything the pane currently holds, newest page + any older pages loaded by
  // scrolling up. Kept in a ref as well as state because the poll folds into it.
  const allRef = useRef<Message[]>([]);
  // Cursor for the next OLDER page, plus whether one exists. While no older page
  // has been loaded these track the newest page (its `nextStart` moves as new
  // messages arrive); after the first load they only advance backwards.
  const olderCursor = useRef<number | undefined>(undefined);
  const hasOlder = useRef(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const loadingOlderRef = useRef(false);
  const walkedBack = useRef(false);

  // Initial load + a gentle 4s poll so messages from others show up without a
  // manual reload — chat has no live socket, so the phone polls the same way the
  // desktop pane (Conversation.tsx) does.
  useEffect(() => {
    let active = true;
    // Paint the cached messages for this thread at once (stale-while-revalidate);
    // only spin when we have nothing cached to show.
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
    void fetchOnce();
    const poll = setInterval(() => void fetchOnce(), 4000);
    return () => {
      active = false;
      clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  // Scrolling up past the top of what we hold walks the cursor backwards. The list
  // grows upward, so the scroll position is restored by distance-from-the-bottom —
  // otherwise inserting above the viewport would jump the user away from where they
  // were reading.
  async function loadOlder() {
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
  }

  // Auto-scroll only when a NEW message arrives AND the user is at the bottom
  // (or just sent one). Keying on the last message id — not the whole array —
  // means a 4s poll that returns nothing new never re-scrolls, so reading a tall
  // last message (scrolled up within it) is never interrupted.
  //
  // Scrolling the container itself, not `bottomRef.scrollIntoView()`: the sentinel's
  // bottom edge is above the list's own bottom padding, so aligning to it left that
  // padding unscrolled and the thread opened a few pixels short of the end.
  const lastMessageId = messages.length ? messages[messages.length - 1].id : 0;
  useEffect(() => {
    const el = listRef.current;
    if (lastMessageId && atBottomRef.current && el)
      el.scrollTop = el.scrollHeight;
  }, [lastMessageId]);

  function send(e: FormEvent) {
    e.preventDefault();
    const content = text.trim();
    if (!content) return;
    // Handed to the outbox, which owns delivery from here: it retries until the server takes it.
    // The composer clears at once because the message IS going to be sent.
    outbox.enqueue(content);
    atBottomRef.current = true;
    setText("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void send(e as unknown as FormEvent);
    }
  }

  return (
    <>
      <div
        ref={listRef}
        onScroll={() => {
          const el = listRef.current;
          if (!el) return;
          atBottomRef.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 100;
          if (el.scrollTop < 200) void loadOlder();
        }}
        className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col gap-1 overflow-y-auto px-3 py-3"
      >
        {loadingOlder && (
          <div className="py-2 text-center text-[11px] text-neutral-500">
            loading earlier messages…
          </div>
        )}
        {loading && <Loading />}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {!loading && messages.length === 0 && (
          <div className="flex flex-1 items-center justify-center text-sm text-neutral-500">
            say hello 👋
          </div>
        )}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const showTime = !prev || gapTooBig(prev.createdAt, m.createdAt);
          return (
            <div key={m.id} className="flex flex-col">
              {showTime && (
                <div className="my-2 text-center text-[11px] text-neutral-500">
                  {fmtSep(m.createdAt)}
                </div>
              )}
              <MessageRow
                message={m}
                mine={m.senderId === currentUserId}
                sender={memberById.get(m.senderId)}
              />
            </div>
          );
        })}
        {outbox.pending.map((p) => (
          <PendingRow
            key={p.clientToken}
            pending={p}
            onRetry={() => outbox.retry(p.clientToken)}
            onDiscard={() => outbox.discard(p.clientToken)}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={send}
        className="bg-background/95 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur"
      >
        <div className="mx-auto flex w-full max-w-2xl items-end gap-2 p-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="message…"
            rows={1}
            className="max-h-32 min-h-10 flex-1 resize-none rounded-lg"
          />
          <button
            type="submit"
            disabled={!text.trim()}
            className="flex h-10 items-center justify-center rounded-md px-4 text-sm font-semibold text-white transition-opacity disabled:opacity-40"
            style={{ backgroundColor: "#07c160" }}
          >
            send
          </button>
        </div>
      </form>
    </>
  );
}

/**
 * A message on its way, or one the server refused.
 *
 * While it is on its way it looks like an ordinary own-message bubble, only dimmed with a small
 * clock — no error, no red, because nothing has gone wrong yet: the outbox is still trying. Only a
 * refusal (not a member any more, thread gone, content rejected) turns it into something the user
 * must act on, and then the choice is explicit: try again, or take the text back.
 */
function PendingRow({
  pending: p,
  onRetry,
  onDiscard,
}: {
  pending: Pending;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  const failed = p.state === "failed";
  return (
    <div className="flex flex-col">
      <div className="flex flex-row-reverse items-start gap-2">
        <div className="size-9 shrink-0" />
        <div className="flex max-w-[72%] min-w-0 flex-col items-end">
          <div
            className={
              failed
                ? "rounded-lg px-3 py-2 text-sm opacity-100"
                : "rounded-lg px-3 py-2 text-sm opacity-60"
            }
            style={{ backgroundColor: OWN_BG, color: OWN_FG }}
          >
            <span className="break-words whitespace-pre-wrap wrap-anywhere">
              {p.content}
            </span>
          </div>
          {failed ? (
            <div className="mt-0.5 flex items-center gap-2 px-1 text-xs text-red-600">
              <span>not sent{p.error ? `: ${p.error}` : ""}</span>
              <button type="button" onClick={onRetry} className="underline">
                retry
              </button>
              <button type="button" onClick={onDiscard} className="underline">
                remove
              </button>
            </div>
          ) : (
            <span className="mt-0.5 flex items-center gap-1 px-1 text-[11px] text-neutral-500">
              <Clock className="size-3" />
              sending…
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageRow({
  message,
  mine,
  sender,
}: {
  message: Message;
  mine: boolean;
  /** The thread's row for the author — it carries their name and avatar. */
  sender?: ThreadMember;
}) {
  const presence = useAgentPresence();
  const name =
    sender?.nickname ??
    presence.data[message.senderId]?.nickname ??
    `user #${message.senderId}`;
  return (
    <div
      className={
        mine
          ? "flex flex-row-reverse items-start gap-2"
          : "flex flex-row items-start gap-2"
      }
    >
      <UserAvatar
        userId={message.senderId}
        nickname={sender?.nickname}
        avatarId={sender?.avatarId}
      />
      <div
        className={
          mine
            ? "flex max-w-[72%] min-w-0 flex-col items-end"
            : "flex max-w-[72%] min-w-0 flex-col"
        }
      >
        {!mine && (
          <span className="mb-0.5 px-1 text-xs text-neutral-500">{name}</span>
        )}
        <div
          className="relative rounded-lg px-3 py-2 text-sm"
          style={{
            backgroundColor: mine ? OWN_BG : OTHER_BG,
            color: mine ? OWN_FG : OTHER_FG,
          }}
        >
          <span
            className="absolute top-3 size-2 rotate-45"
            style={{
              backgroundColor: mine ? OWN_BG : OTHER_BG,
              left: mine ? undefined : "-3px",
              right: mine ? "-3px" : undefined,
            }}
          />
          <p className="wrap-anywhere whitespace-pre-wrap">{message.content}</p>
        </div>
      </div>
    </div>
  );
}

function gapTooBig(a: string, b: string): boolean {
  return new Date(b).getTime() - new Date(a).getTime() > 5 * 60 * 1000;
}

function fmtSep(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return time;
  return `${d.toLocaleDateString([], { month: "2-digit", day: "2-digit" })} ${time}`;
}
