// Chats — desktop layout for one conversation: the centre column of the chats view. Fills a
// resizable pane (no page header — the parent draws one), a wider column than the phone, and
// Enter sends because there is a keyboard.
//
// Layout only: loading, paging, merging and delivery live in features/chats.
import { useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import type { ThreadMember } from "@/api";
import { useAuth } from "@/hooks/useAuth";
import { useThreadMessages } from "@/features/chats/useThreadMessages";
import {
  MessageRows,
  PendingRow,
} from "@/features/chats/components/MessageList";
import { Textarea } from "@/components/ui/textarea";
import { Loading } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function Conversation({
  threadId,
  members,
}: {
  threadId: number;
  /** The thread's members (owned by the parent, which needs them for the header too). */
  members: ThreadMember[];
}) {
  const { user } = useAuth();
  const memberById = useMemo(
    () => new Map(members.map((m) => [m.userId, m])),
    [members],
  );
  const [text, setText] = useState("");
  const chat = useThreadMessages(threadId, {
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
    // Enter sends (desktop convention); Shift+Enter makes a newline.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(e as unknown as FormEvent);
    }
  }

  return (
    <>
      <div
        ref={chat.listRef}
        onScroll={chat.onScroll}
        className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-6 py-4"
      >
        <div className="mx-auto mt-auto flex w-full max-w-3xl flex-col gap-1">
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
            currentUserId={user?.id}
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
