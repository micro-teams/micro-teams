// A thread's membership and settings: who is in it, who may change that, and the three things you
// can do about it.
//
// Both shells showed this — the phone as a pushed page, the desktop as a right-hand panel — and
// both worked out roles, sorting and removal for themselves. Only the phone ever grew a rename.
import { useCallback, useState } from "react";
import type { ThreadMember, TeamMemberRoleEnum as Role } from "@/api";
import { chatApi, mtCall } from "@/lib/mtApi";
import { useAuth } from "@/hooks/useAuth";
import { errMsg } from "@/hooks/useAsync";

const ROLE_ORDER: Record<Role, number> = { OWNER: 0, ADMIN: 1, MEMBER: 2 };

export interface ThreadInfo {
  /** Members, owners first — the order the grid is drawn in. */
  members: ThreadMember[];
  myUserId?: number;
  canManage: boolean;
  isOwner: boolean;
  busy: boolean;
  error: string | null;
  remove: (userId: number) => Promise<void>;
  add: (userId: number) => Promise<void>;
  rename: (title: string) => Promise<void>;
  /** Resolves true once the thread is gone, so the caller can navigate away. */
  dissolve: () => Promise<boolean>;
}

export function useThreadInfo(
  threadId: number,
  memberList: ThreadMember[],
  reload: () => void,
): ThreadInfo {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const myRole = memberList.find((m) => m.userId === user?.id)?.role;
  const members = [...memberList].sort(
    (a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role],
  );

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      setError(null);
      setBusy(true);
      try {
        await fn();
        reload();
      } catch (err) {
        setError(errMsg(err));
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const remove = useCallback(
    (userId: number) =>
      run(async () => {
        await mtCall(chatApi().removeThreadMember({ id: threadId, userId }));
      }),
    [run, threadId],
  );

  const add = useCallback(
    (userId: number) =>
      run(async () => {
        await mtCall(
          chatApi().addThreadMember({
            id: threadId,
            addMemberRequest: { userId },
          }),
        );
      }),
    [run, threadId],
  );

  const rename = useCallback(
    (title: string) =>
      run(async () => {
        await mtCall(
          chatApi().renameThread({
            id: threadId,
            renameThreadRequest: { title: title.trim() },
          }),
        );
      }),
    [run, threadId],
  );

  // Not routed through `run`: on success the thread no longer exists, so reloading it would only
  // produce a 404 for the caller to render on its way out.
  const dissolve = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      await mtCall(chatApi().dissolveThread({ id: threadId }));
      return true;
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
      return false;
    }
  }, [threadId]);

  return {
    members,
    myUserId: user?.id,
    canManage: myRole === "OWNER" || myRole === "ADMIN",
    isOwner: myRole === "OWNER",
    busy,
    error,
    remove,
    add,
    rename,
    dissolve,
  };
}
