// The chat list, one thread's detail, and creating a thread.
//
// Small on their own; here because a layout that fetches is a layout that can be given a capability
// the other layout never hears about. Both shells listed chats on a 5s poll and both parsed the
// "member ids" box their own way.
import { useCallback, useEffect } from "react";
import type { ThreadDetail } from "@/api";
import { chatApi, mtCall } from "@/lib/mtApi";
import { useAsync } from "@/hooks/useAsync";

/** Until the push channel lands (T-065) the list is polled; the cadence lives here, once. */
const LIST_POLL_MS = 5000;

export function useChats() {
  const chats = useAsync(
    () =>
      mtCall(chatApi().listChats({ pageSize: 100, queryIsMemberAgent: true })),
    [],
    "chats",
  );

  // A steady poll keeps previews, ordering and (later) unread state fresh while sitting on the
  // list. Both shells had one; they had drifted to different intervals for no reason.
  const reload = chats.reload;
  useEffect(() => {
    const t = setInterval(() => reload(), LIST_POLL_MS);
    return () => clearInterval(t);
  }, [reload]);

  return chats;
}

export function useThread(threadId: number | null) {
  return useAsync(
    () =>
      threadId == null
        ? Promise.resolve<ThreadDetail | null>(null)
        : mtCall(chatApi().getThread({ id: threadId })),
    [threadId],
    threadId == null ? undefined : `thread:${threadId}`,
  );
}

/** "12, 34 56" → [12, 34, 56]. Anything that is not a positive integer is dropped. */
export function parseMemberIds(text: string): number[] {
  return text
    .split(/[,\s]+/)
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}

export function useCreateThread() {
  return useCallback(async (title: string, memberIdsText: string) => {
    const memberIds = parseMemberIds(memberIdsText);
    return mtCall(
      chatApi().createThread({
        createThreadRequest: {
          title: title.trim(),
          memberIds: memberIds.length ? memberIds : undefined,
        },
      }),
    );
  }, []);
}
