// Docs — desktop master-detail. Left: team switcher + the recursive document
// tree (the SAME <DocTree> the phone uses — its file rows link to
// /teams/:teamId/file?path=…, which keeps us in this section and drives the
// editor pane on the right via the URL). Right: the markdown editor, or an
// empty state. Tree loading + create/rename/move/delete mirror the phone
// WorkspacePage; selecting a file just changes the URL.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { ChevronDown, Settings2, Plus, FolderGit2 } from "lucide-react";
import type { DocNode } from "@/api";
import {
  baseName,
  createFolder,
  deletePath,
  movePath,
  parentPath,
} from "@/lib/docs";
import { mtCall, teamApi } from "@/lib/mtApi";
import { useWorkspace } from "@/hooks/useWorkspace";
import { errMsg } from "@/hooks/useAsync";
import { DocTree, type NodeAction } from "@/components/DocTree";
import { DocEditor } from "@/desktop/DocEditor";
import {
  Menu,
  MenuItem,
  MenuSeparator,
  MenuCheckItem,
} from "@/components/ui/menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Loading } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface PendingAction {
  node: DocNode;
  kind: NodeAction;
}

export function DocsDesktop() {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const teamId = ws.teamId;

  // The file open in the editor is read from the URL, so DocTree's plain <Link>
  // rows (and deep links) drive the right pane with no extra wiring.
  const fileMatch = location.pathname.match(/^\/teams\/(\d+)\/file/);
  const fileTeamId = fileMatch ? Number(fileMatch[1]) : null;
  const filePath = fileMatch ? (params.get("path") ?? "") : null;
  const fileIsNew = params.get("new") === "1";

  const [tree, setTree] = useState<DocNode | null>(() =>
    teamId != null ? (ws.treeFor(teamId) ?? null) : null,
  );
  const [loading, setLoading] = useState(tree === null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);

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

  // Show cached tree instantly on team change, revalidate in the background.
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
    load(teamId, cached == null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  const currentTeam = ws.teams?.find((t) => t.id === teamId);

  async function onAction(node: DocNode, kind: NodeAction) {
    if (teamId == null) return;
    if (kind === "delete") {
      const label = baseName(node.path);
      const msg = node.isFolder
        ? `Delete folder "${label}" and everything inside it?`
        : `Delete "${label}"?`;
      if (!confirm(msg)) return;
      try {
        await deletePath(teamId, node);
        await load(teamId, false);
        // If the open file was under what we deleted, clear the editor.
        if (filePath && filePath.startsWith(node.path)) navigate("/teams");
      } catch (err) {
        setError(errMsg(err));
      }
      return;
    }
    setPending({ node, kind });
  }

  return (
    <div className="flex h-full min-w-0 flex-1">
      {/* ---- tree ---- */}
      <aside className="flex w-72 shrink-0 flex-col border-r">
        <header className="flex h-14 shrink-0 items-center gap-2 px-3">
          <Menu
            trigger={
              <button
                type="button"
                className="bg-secondary text-secondary-foreground flex min-w-0 max-w-full items-center gap-1 rounded-md px-2.5 py-1.5 text-sm font-medium"
              >
                <FolderGit2 className="size-4 shrink-0" />
                <span className="truncate">{currentTeam?.name ?? "team"}</span>
                <ChevronDown className="size-3.5 shrink-0" />
              </button>
            }
            align="start"
          >
            {(ws.teams ?? []).map((t) => (
              <MenuCheckItem
                key={t.id}
                checked={t.id === teamId}
                icon={<FolderGit2 className="size-4" />}
                onSelect={() => ws.setTeamId(t.id)}
              >
                {t.name}
              </MenuCheckItem>
            ))}
            {ws.teams && ws.teams.length > 0 && <MenuSeparator />}
            <MenuItem
              icon={<Settings2 className="size-4" />}
              onSelect={() => navigate("/teams/manage")}
            >
              Manage teams
            </MenuItem>
          </Menu>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto pb-4">
          {ws.teams && ws.teams.length === 0 ? (
            <EmptyTeams onManage={() => navigate("/teams/manage")} />
          ) : (
            <>
              {loading && <Loading />}
              {error && (
                <div className="p-3">
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                </div>
              )}
              {tree && teamId != null && currentTeam && (
                <DocTree
                  teamId={teamId}
                  root={tree}
                  teamName={currentTeam.name}
                  onAction={onAction}
                />
              )}
            </>
          )}
        </div>
      </aside>

      {/* ---- editor / empty ---- */}
      {fileTeamId != null && filePath != null ? (
        <DocEditor
          key={`${fileTeamId}:${filePath}`}
          teamId={fileTeamId}
          path={filePath}
          isNew={fileIsNew}
        />
      ) : (
        <section className="text-muted-foreground flex min-w-0 flex-1 flex-col items-center justify-center gap-3">
          <FolderGit2 className="size-12 opacity-30" />
          <p className="text-sm">select a document to edit</p>
        </section>
      )}

      {pending && teamId != null && (
        <DocActionModal
          teamId={teamId}
          node={pending.node}
          kind={pending.kind}
          onClose={() => setPending(null)}
          onDone={(expand) => {
            for (const p of expand) ws.setExpanded(teamId, p, true);
            load(teamId, false);
          }}
        />
      )}
    </div>
  );
}

function EmptyTeams({ onManage }: { onManage: () => void }) {
  return (
    <div className="text-muted-foreground flex flex-col items-center gap-3 py-20 text-sm">
      <FolderGit2 className="size-10 opacity-50" />
      you have no teams yet
      <Button size="sm" onClick={onManage}>
        <Plus className="size-4" /> create a team
      </Button>
    </div>
  );
}

const TITLES: Record<NodeAction, string> = {
  "create-file": "New file",
  "create-folder": "New folder",
  rename: "Rename",
  move: "Move",
  delete: "",
};

// Ported from the phone WorkspacePage — identical semantics; create-file navigates
// to the file URL with ?new=1, which opens a blank editor on the right.
function DocActionModal({
  teamId,
  node,
  kind,
  onClose,
  onDone,
}: {
  teamId: number;
  node: DocNode;
  kind: NodeAction;
  onClose: () => void;
  onDone: (expand: string[]) => void;
}) {
  const navigate = useNavigate();
  const parent = node.isFolder ? node.path : parentPath(node.path);
  const creating = kind === "create-file" || kind === "create-folder";

  const [value, setValue] = useState(() => {
    if (kind === "rename") return baseName(node.path);
    if (kind === "move") return node.path;
    return "";
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPath = kind === "move";
  const label = isPath ? "new path" : "name";
  const placeholder =
    kind === "create-folder"
      ? "my-folder"
      : kind === "move"
        ? "dir/file.md"
        : "notes.md";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const clean = value.trim().replace(/^\/+|\/+$/g, "");
    if (!clean) return;
    if (clean.includes("..")) {
      setError("path may not contain '..'");
      return;
    }

    if (kind === "create-file") {
      const full = parent ? `${parent}/${clean}` : clean;
      onClose();
      navigate(`/teams/${teamId}/file?path=${encodeURIComponent(full)}&new=1`);
      return;
    }

    setError(null);
    setBusy(true);
    try {
      if (kind === "create-folder") {
        const full = parent ? `${parent}/${clean}` : clean;
        await createFolder(teamId, full);
        onClose();
        onDone([parent, full].filter(Boolean));
      } else if (kind === "rename") {
        const full = parent ? `${parent}/${clean}` : clean;
        await movePath(teamId, node, full);
        onClose();
        onDone([parent].filter(Boolean));
      } else if (kind === "move") {
        await movePath(teamId, node, clean);
        onClose();
        onDone([parentPath(clean)].filter(Boolean));
      }
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  }

  const title =
    creating && parent ? `${TITLES[kind]} in ${parent}/` : TITLES[kind];

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={title}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="doc-value">{label}</Label>
          <Input
            id="doc-value"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            className={isPath ? "font-mono" : undefined}
            autoFocus
            required
          />
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Button type="submit" disabled={busy || !value.trim()}>
          {kind === "create-file"
            ? "create & edit"
            : busy
              ? "working…"
              : creating
                ? "create"
                : "save"}
        </Button>
      </form>
    </Modal>
  );
}
