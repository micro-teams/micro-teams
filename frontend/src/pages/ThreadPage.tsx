// Chats — phone layout for one conversation: a pushed full-screen view with its own header, the
// list sized to the VISIBLE viewport so the composer stays above the on-screen keyboard, and
// Cmd/Ctrl+Enter to send (plain Enter has to insert a newline on a phone keyboard).
//
// Layout only: loading, paging, merging and delivery live in features/chats.
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
import type { ThreadMember } from "@/api";
import { useAuth } from "@/hooks/useAuth";
import { useThread } from "@/features/chats/useChats";
import { useThreadMessages } from "@/features/chats/useThreadMessages";
import {
  MessageRows,
  PendingRow,
} from "@/features/chats/components/MessageList";
import { PageHeader } from "@/components/PageHeader";
import { Textarea } from "@/components/ui/textarea";
import { Loading } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function ThreadPage() {
  const { threadId: threadIdParam } = useParams();
  const threadId = Number(threadIdParam);
  const navigate = useNavigate();
  const { user } = useAuth();
  const rootRef = useRef<HTMLDivElement>(null);

  const detail = useThread(threadId);

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
  const [text, setText] = useState("");
  const chat = useThreadMessages(threadId, {
    // A message the user gave up on goes back to the composer rather than vanishing.
    onDiscard: (content) => setText((t) => (t.trim() ? t : content)),
  });

  function send(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    chat.send(text);
    // The composer clears at once because the message IS going to be sent.
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
        ref={chat.listRef}
        onScroll={chat.onScroll}
        className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col gap-1 overflow-y-auto px-3 py-3"
      >
        {chat.loadingOlder && (
          <div className="py-2 text-center text-[11px] text-neutral-500">
            loading earlier messages…
          </div>
        )}
        {chat.loading && <Loading />}
        {chat.error && (
          <Alert variant="destructive">
            <AlertDescription>{chat.error}</AlertDescription>
          </Alert>
        )}
        {!chat.loading && chat.messages.length === 0 && (
          <div className="flex flex-1 items-center justify-center text-sm text-neutral-500">
            say hello 👋
          </div>
        )}
        <MessageRows
          messages={chat.messages}
          currentUserId={currentUserId}
          memberById={memberById}
        />
        {chat.pending.map((p) => (
          <PendingRow
            key={p.clientToken}
            pending={p}
            onRetry={() => chat.retry(p.clientToken)}
            onDiscard={() => chat.discard(p.clientToken)}
          />
        ))}
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
