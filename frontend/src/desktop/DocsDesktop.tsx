// Docs — desktop layout: master-detail. Left, the team switcher and the tree; right, the editor for
// whatever file the URL names, so DocTree's plain <Link> rows and deep links both drive the pane
// with no extra wiring.
//
// Layout only: fetching, caching, revalidating and deleting live in features/docs/useDocTree.
import { useState } from "react";
import { useNavigate } from "react-router";
import {
  useSectionLocation,
  useSectionSearchParams,
} from "@/desktop/sectionKeepAlive";
import { ChevronDown, Settings2, Plus, FolderGit2 } from "lucide-react";
import type { DocNode } from "@/api";
import { baseName } from "@/features/docs/api";
import { useDocTree } from "@/features/docs/useDocTree";
import { DocTree, type NodeAction } from "@/features/docs/components/DocTree";
import { DocActionModal } from "@/features/docs/components/DocActionModal";
import { useWorkspace } from "@/hooks/useWorkspace";
import { DocEditor } from "@/desktop/DocEditor";
import {
  Menu,
  MenuItem,
  MenuSeparator,
  MenuCheckItem,
} from "@/components/ui/menu";
import { Button } from "@/components/ui/button";
import { Loading } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface PendingAction {
  node: DocNode;
  kind: NodeAction;
}

export function DocsDesktop() {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const location = useSectionLocation();
  const params = useSectionSearchParams();
  const teamId = ws.teamId;
  const docs = useDocTree(teamId);
  const [pending, setPending] = useState<PendingAction | null>(null);

  // The file open in the editor is read from the URL.
  const fileMatch = location.pathname.match(/^\/teams\/(\d+)\/file/);
  const fileTeamId = fileMatch ? Number(fileMatch[1]) : null;
  const filePath = fileMatch ? (params.get("path") ?? "") : null;
  const fileIsNew = params.get("new") === "1";

  const currentTeam = ws.teams?.find((t) => t.id === teamId);

  async function onAction(node: DocNode, kind: NodeAction) {
    if (teamId == null) return;
    if (kind === "delete") {
      const label = baseName(node.path);
      const msg = node.isFolder
        ? `Delete folder "${label}" and everything inside it?`
        : `Delete "${label}"?`;
      if (!confirm(msg)) return;
      await docs.remove(node);
      // If the open file was under what we deleted, clear the editor.
      if (filePath && filePath.startsWith(node.path)) navigate("/teams");
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
              {docs.loading && <Loading />}
              {docs.error && (
                <div className="p-3">
                  <Alert variant="destructive">
                    <AlertDescription>{docs.error}</AlertDescription>
                  </Alert>
                </div>
              )}
              {docs.tree && teamId != null && currentTeam && (
                <DocTree
                  teamId={teamId}
                  root={docs.tree}
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
            void docs.reload();
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
