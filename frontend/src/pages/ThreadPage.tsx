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
import { useAuth } from "@/hooks/useAuth";
import { useAsync, errMsg } from "@/hooks/useAsync";
import { PageHeader } from "@/components/PageHeader";
import { UserAvatar } from "@/components/UserAvatar";
import { useAgentPresence } from "@/hooks/useAgentPresence";
import { Textarea } from "@/components/ui/textarea";
import { Loading, Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";

// WeChat-ish bubble colours (recognisable green for your own messages).
const OWN_BG = "#95ec69";
const OWN_FG = "#111111";
const OTHER_BG = "#2c2c2e";
const OTHER_FG = "#ffffff";

export function ThreadPage() {
  const { threadId: threadIdParam } = useParams();
  const threadId = Number(threadIdParam);
  const navigate = useNavigate();
  const { user } = useAuth();

  const detail = useAsync(
    () => mtCall(chatApi().getThread({ id: threadId })),
    [threadId],
  );

  return (
    <div className="flex h-svh flex-col bg-[#111111]">
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
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    mtCall(chatApi().listMessages({ id: threadId, pageSize: 200 }))
      .then((res) => active && setMessages(res.messages))
      .catch((err: unknown) => active && setError(errMsg(err)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
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
      setMessages((prev) => [...prev, msg]);
      setText("");
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void send(e as unknown as FormEvent);
    }
  }

  return (
    <>
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-1 overflow-y-auto px-3 py-3">
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
            disabled={sending || !text.trim()}
            className="flex h-10 items-center justify-center rounded-md px-4 text-sm font-semibold text-white transition-opacity disabled:opacity-40"
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
            ? "flex max-w-[72%] flex-col items-end"
            : "flex max-w-[72%] flex-col"
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
