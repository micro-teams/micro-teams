// The messages themselves: bubbles, time separators, and the ones still on their way.
//
// Both shells drew these, and the copies had drifted in small ways that no one chose — a different
// red for "not sent", a different grey for "sending…", bubbles capped at 68% on one side and 72% on
// the other. None of that was a decision; it is just what two copies do over time. One copy now,
// and the shells keep only the things they genuinely differ on: the width of the column it sits in
// and where the composer goes.
import { Clock } from "lucide-react";
import type { Message, ThreadMember } from "@/api";
import { UserAvatar } from "@/components/UserAvatar";
import { useAgentPresence } from "@/hooks/useAgentPresence";
import type { Pending } from "@/hooks/useOutbox";

// WeChat-ish bubble colours (recognisable green for your own messages).
export const OWN_BG = "#95ec69";
export const OWN_FG = "#111111";
export const OTHER_BG = "#2c2c2e";
export const OTHER_FG = "#ffffff";

/** A message and, when the gap before it is long enough, the time separator above it. */
export function MessageRows({
  messages,
  currentUserId,
  memberById,
}: {
  messages: Message[];
  currentUserId?: number;
  memberById: Map<number, ThreadMember>;
}) {
  return (
    <>
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

/**
 * A message on its way, or one the server refused.
 *
 * While it is on its way it looks like an ordinary own-message bubble, only dimmed with a small
 * clock — no error, no red, because nothing has gone wrong yet: the outbox is still trying. Only a
 * refusal (not a member any more, thread gone, content rejected) turns it into something the user
 * must act on, and then the choice is explicit: try again, or take the text back.
 */
export function PendingRow({
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
