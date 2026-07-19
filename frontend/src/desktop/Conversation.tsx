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
import { useAuth } from "@/hooks/useAuth";
import { errMsg } from "@/hooks/useAsync";
import { UserAvatar } from "@/components/UserAvatar";
import { useAgentPresence } from "@/hooks/useAgentPresence";
import { Textarea } from "@/components/ui/textarea";
import { Loading, Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";

// WeChat-ish bubble colours (recognisable green for your own messages) — identical
// to the phone thread so the two shells read as one product.
const OWN_BG = "#95ec69";
const OWN_FG = "#111111";
const OTHER_BG = "#2c2c2e";
const OTHER_FG = "#ffffff";

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
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Initial load + a gentle 4s poll for liveness. Replace wholesale — the list is
  // small (last 200) and the server is the source of truth.
  useEffect(() => {
    let active = true;
    setLoading(true);
    setMessages([]);
    const fetchOnce = (spin: boolean) => {
      if (spin) setLoading(true);
      return mtCall(chatApi().listMessages({ id: threadId, pageSize: 200 }))
        .then((res) => active && setMessages(res.messages))
        .catch((err: unknown) => active && setError(errMsg(err)))
        .finally(() => active && setLoading(false));
    };
    void fetchOnce(true);
    const poll = setInterval(() => void fetchOnce(false), 4000);
    return () => {
      active = false;
      clearInterval(poll);
    };
  }, [threadId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const content = text.trim();
    if (!content) return;
    setSending(true);
    setError(null);
    try {
      const msg = await mtCall(
        chatApi().postMessage({
          id: threadId,
          postMessageRequest: { content },
        }),
      );
      setMessages((prev) =>
        prev.some((m) => m.id === msg.id) ? prev : [...prev, msg],
      );
      setText("");
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setSending(false);
    }
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
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto mt-auto flex w-full max-w-3xl flex-col gap-1">
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
            disabled={sending || !text.trim()}
            className="flex h-11 items-center justify-center rounded-md px-5 text-sm font-semibold text-white transition-opacity disabled:opacity-40"
            style={{ backgroundColor: "#07c160" }}
          >
            {sending ? <Spinner className="text-white" /> : "send"}
          </button>
        </div>
      </form>
    </>
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
          <p className="break-words whitespace-pre-wrap">{message.content}</p>
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
