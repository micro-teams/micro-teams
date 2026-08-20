// The chat list, one thread's detail, and creating a thread.
//
// Small on their own; here because a layout that fetches is a layout that can be given a capability
// the other layout never hears about. Both shells listed chats on a 5s poll and both parsed the
// "member ids" box their own way.
import { useCallback } from "react";
import type { ThreadDetail } from "@/api";
import { chatApi, mtCall } from "@/lib/mtApi";
import { useAsync } from "@/hooks/useAsync";
import { useAuth } from "@/hooks/useAuth";
import { useUpdatesTopic } from "@/hooks/useUpdates";
import { chatsTopic } from "@/lib/updates/topics";

export function useChats() {
  const { user } = useAuth();
  const chats = useAsync(
    () =>
      mtCall(chatApi().listChats({ pageSize: 100, queryIsMemberAgent: true })),
    [],
    "chats",
  );

  // Was a 5s poll. The list now refetches when the server says this user's list moved, and the
  // periodic check compares what we hold against what it should be — so a change that failed to
  // publish an event is reported by topic instead of being quietly papered over on the next tick.
  //
  // The digest mirrors ChatsQuery.digest on the server, and is deliberately just the number of
  // groups: the list the browser holds carries no message id, and digesting a timestamp would make
  // two independent renderings of the same instant have to agree forever. See ChatsQuery for what
  // that does and does not catch.
  useUpdatesTopic(
    user ? chatsTopic(user.id) : null,
    () => chats.reload(),
    () => {
      const list = chats.data?.chats;
      return list ? `${list.length}` : null;
    },
  );

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
