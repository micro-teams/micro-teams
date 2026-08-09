// Docs — phone layout for the tree: a page header carrying the team switcher, then the tree at
// full width. Tapping a file pushes FilePage. Scroll position is preserved across tab switches,
// which is a phone-shell concern (MobileTabs keeps this page mounted).
//
// Layout only: fetching, caching, revalidating and deleting live in features/docs/useDocTree.
import { useLayoutEffect, useState } from "react";
import { useNavigate } from "react-router";
import { ChevronDown, Settings2, Plus, FolderGit2 } from "lucide-react";
import type { DocNode } from "@/api";
import { baseName } from "@/features/docs/api";
import { useDocTree } from "@/features/docs/useDocTree";
import { DocTree, type NodeAction } from "@/features/docs/components/DocTree";
import { DocActionModal } from "@/features/docs/components/DocActionModal";
import { useWorkspace } from "@/hooks/useWorkspace";
import { PageHeader } from "@/components/PageHeader";
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

export function WorkspacePage() {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const teamId = ws.teamId;
  const docs = useDocTree(teamId);
  const [pending, setPending] = useState<PendingAction | null>(null);

  // Preserve scroll across tab switches.
  useLayoutEffect(() => {
    window.scrollTo(0, ws.scrollTop);
    const onScroll = () => ws.setScrollTop(window.scrollY);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentTeam = ws.teams?.find((t) => t.id === teamId);

  function onAction(node: DocNode, kind: NodeAction) {
    if (teamId == null) return;
    if (kind === "delete") {
      const label = baseName(node.path);
      const msg = node.isFolder
        ? `Delete folder "${label}" and everything inside it?`
        : `Delete "${label}"?`;
      if (!confirm(msg)) return;
      void docs.remove(node);
      return;
    }
    setPending({ node, kind });
  }

  return (
    <>
      <PageHeader
        title="docs"
        actions={
          <Menu
            trigger={
              <button
                type="button"
                className="bg-secondary text-secondary-foreground flex max-w-[10rem] items-center gap-1 rounded-md px-2.5 py-1.5 text-sm font-medium"
              >
                <span className="truncate">{currentTeam?.name ?? "team"}</span>
                <ChevronDown className="size-3.5 shrink-0" />
              </button>
            }
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
        }
      />

      <div className="flex flex-col">
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
    </>
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
