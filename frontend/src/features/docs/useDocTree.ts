// A team's document tree: how it is fetched, cached, revalidated, and acted on.
//
// The cache lives in the workspace provider (so switching tabs does not reload and re-flash the
// tree); this hook owns everything about keeping it true. Both shells call it and then render —
// the phone as a full-height list, the desktop as the left pane of a master-detail — and neither
// of them contains a request.
import { useCallback, useEffect, useState } from "react";
import type { DocNode } from "@/api";
import { mtCall, teamApi } from "@/lib/mtApi";
import { useWorkspace } from "@/hooks/useWorkspace";
import { errMsg } from "@/hooks/useAsync";
import { deletePath } from "@/features/docs/api";

export interface DocTreeState {
  tree: DocNode | null;
  loading: boolean;
  error: string | null;
  setError: (message: string | null) => void;
  /** Refetch without a spinner — the cached tree stays on screen until the answer lands. */
  reload: () => Promise<void>;
  /** Delete a file or a whole folder, then refresh. Confirmation belongs to the caller. */
  remove: (node: DocNode) => Promise<void>;
}

export function useDocTree(teamId: number | null): DocTreeState {
  const ws = useWorkspace();
  const [tree, setTree] = useState<DocNode | null>(() =>
    teamId != null ? (ws.treeFor(teamId) ?? null) : null,
  );
  const [loading, setLoading] = useState(tree === null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (id: number, showSpinner: boolean) => {
      if (showSpinner) setLoading(true);
      setError(null);
      try {
        const node = await mtCall(
          teamApi().getDocument({ id, path: "", recursive: true }),
        );
        ws.setTree(id, node);
        setTree(node);
      } catch (err) {
        setError(errMsg(err));
      } finally {
        setLoading(false);
      }
    },
    [ws],
  );

  // On team change: paint the cached tree at once (no flash), revalidate behind it. A first visit
  // has nothing cached, so it spins and opens the root.
  useEffect(() => {
    if (teamId == null) {
      setTree(null);
      setLoading(false);
      return;
    }
    const cached = ws.treeFor(teamId);
    setTree(cached ?? null);
    setLoading(cached == null);
    if (cached == null) ws.setExpanded(teamId, "", true);
    void load(teamId, cached == null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  // The tree is otherwise fetched once per team and never again, so a file an agent creates while
  // you sit on this page never appears. Same treatment the open document gets, and no spinner:
  // what is on screen stays until the new answer arrives. (T-053)
  useEffect(() => {
    if (teamId == null) return;
    function revalidate() {
      if (document.visibilityState === "visible") void load(teamId!, false);
    }
    document.addEventListener("visibilitychange", revalidate);
    window.addEventListener("focus", revalidate);
    return () => {
      document.removeEventListener("visibilitychange", revalidate);
      window.removeEventListener("focus", revalidate);
    };
  }, [teamId, load]);

  const reload = useCallback(async () => {
    if (teamId != null) await load(teamId, false);
  }, [teamId, load]);

  const remove = useCallback(
    async (node: DocNode) => {
      if (teamId == null) return;
      try {
        await deletePath(teamId, node);
        await load(teamId, false);
      } catch (err) {
        setError(errMsg(err));
      }
    },
    [teamId, load],
  );

  return { tree, loading, error, setError, reload, remove };
}
