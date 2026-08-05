// Desktop conversation pane — the center column of the chats view. Same WeChat-ish
// bubbles and agent-aware avatars as the phone ThreadPage, but laid out to fill a
// resizable pane (no PageHeader, wider column) and with a light liveness poll so
// new messages appear without a manual reload.
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import type { Message, ThreadMember } from "@/api";
import { chatApi, mtCall } from "@/lib/mtApi";
import { getCache, setCache } from "@/lib/cache";
import { mergeNewestPage, mergeOlderPage } from "@/lib/messages";
import { useAuth } from "@/hooks/useAuth";
import { errMsg } from "@/hooks/useAsync";
import { UserAvatar } from "@/components/UserAvatar";
import { useAgentPresence } from "@/hooks/useAgentPresence";
import { useOutbox, type Pending } from "@/hooks/useOutbox";
import { Textarea } from "@/components/ui/textarea";
import { Clock } from "lucide-react";
import { Loading } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";

// WeChat-ish bubble colours (recognisable green for your own messages) — identical
// to the phone thread so the two shells read as one product.
const OWN_BG = "#95ec69";
const OWN_FG = "#111111";
const OTHER_BG = "#2c2c2e";
const OTHER_FG = "#ffffff";

// Messages per request — both for the newest page (polled) and for each older page
// walked backwards through history.
const PAGE_SIZE = 100;

export function Conversation({
  threadId,
  members,
}: {
  threadId: number;
  /** The thread's members (owned by the parent, which needs them for the header too). */
  members: ThreadMember[];
}) {
  const { user } = useAuth();
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#111111]">
      <MessageList
        threadId={threadId}
        currentUserId={user?.id}
        members={members}
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
    onDiscard: (content) => setText((t) => (t.trim() ? t : content)),
  });
  // Whether the view is pinned to the bottom. Starts true (opening a thread lands
  // on the newest message); flips off once the user scrolls up to read history,
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

  // Initial load + a gentle 4s poll for liveness. The poll asks for the newest page
  // and is folded in (see lib/messages) rather than replacing the list: replacing it
  // wholesale threw away every older page the user had scrolled up to load.
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
    // Enter sends (desktop convention); Shift+Enter makes a newline.
    if (e.key === "Enter" && !e.shiftKey) {
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
        className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-6 py-4"
      >
        <div className="mx-auto mt-auto flex w-full max-w-3xl flex-col gap-1">
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
      </div>

      <form onSubmit={send} className="border-t border-white/10 bg-[#1a1a1c]">
        <div className="mx-auto flex w-full max-w-3xl items-end gap-2 p-3">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="message…  (Enter to send, Shift+Enter for newline)"
            rows={1}
            className="max-h-40 min-h-11 flex-1 resize-none rounded-lg"
          />
          <button
            type="submit"
            disabled={!text.trim()}
            className="flex h-11 items-center justify-center rounded-md px-5 text-sm font-semibold text-white transition-opacity disabled:opacity-40"
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
 * A message on its way, or one the server refused. On its way it is just a dimmed own-message bubble
 * with a clock — nothing red, because nothing has failed yet; the outbox is still trying. A refusal
 * is the only thing that asks the user to decide: try again, or take the text back.
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
                ? "rounded-lg px-3 py-2 text-sm"
                : "rounded-lg px-3 py-2 text-sm opacity-60"
            }
            style={{ backgroundColor: OWN_BG, color: OWN_FG }}
          >
            <span className="break-words whitespace-pre-wrap wrap-anywhere">
              {p.content}
            </span>
          </div>
          {failed ? (
            <div className="mt-0.5 flex items-center gap-2 px-1 text-xs text-red-400">
              <span>not sent{p.error ? `: ${p.error}` : ""}</span>
              <button type="button" onClick={onRetry} className="underline">
                retry
              </button>
              <button type="button" onClick={onDiscard} className="underline">
                remove
              </button>
            </div>
          ) : (
            <span className="mt-0.5 flex items-center gap-1 px-1 text-[11px] text-neutral-400">
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
            ? "flex max-w-[68%] min-w-0 flex-col items-end"
            : "flex max-w-[68%] min-w-0 flex-col"
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
