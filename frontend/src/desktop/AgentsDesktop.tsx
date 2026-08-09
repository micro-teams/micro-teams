// Agents — desktop master-detail. Left: team switcher + the machines that serve
// it + the agents open on them (selectable). Right: the selected agent — a big
// avatar (click it for the live screen, same as everywhere), its live status/driver/machine,
// and the two things a human needs, "chat with it" (creates a thread including the
// agent and jumps to it) and "close it". Selection lives in the URL (/agents/:id)
// so deep links and the browser back button work; the rail switches sections.
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useSectionLocation } from "@/desktop/sectionKeepAlive";
import {
  Bot,
  ChevronDown,
  FolderGit2,
  MessageSquarePlus,
  Pencil,
  PlusCircle,
  Server,
  Settings2,
  Trash2,
  Unlink,
} from "lucide-react";
import type { Agent, Machine } from "@/api";
import { machineLabel } from "@/lib/agents";
import { useTeamAgents } from "@/features/agents/useTeamAgents";
import { useWorkspace } from "@/hooks/useWorkspace";
import { UserAvatar } from "@/components/UserAvatar";
import { ChangeAvatar } from "@/components/ChangeAvatar";
import { AgentKeepaliveControl } from "@/features/agents/components/AgentKeepaliveControl";
import {
  OpenAgentDialog,
  OnlineDot,
} from "@/features/agents/components/OpenAgentDialog";
import { AddDeviceDialog } from "@/features/agents/components/AddDeviceDialog";
import { RenameMachineDialog } from "@/features/agents/components/RenameMachineDialog";
import { RenameAgentDialog } from "@/features/agents/components/RenameAgentDialog";
import { Button } from "@/components/ui/button";
import {
  Menu,
  MenuCheckItem,
  MenuItem,
  MenuSeparator,
} from "@/components/ui/menu";
import { Loading } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

export function AgentsDesktop() {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const location = useSectionLocation();
  const teamId = ws.teamId;
  const [openDlg, setOpenDlg] = useState(false);
  const [addDeviceDlg, setAddDeviceDlg] = useState(false);
  const [renaming, setRenaming] = useState<Machine | null>(null);
  const [renamingAgent, setRenamingAgent] = useState<Agent | null>(null);

  const selectedId = useMemo(() => {
    const m = location.pathname.match(/^\/agents\/(\d+)/);
    return m ? Number(m[1]) : null;
  }, [location.pathname]);

  const team = useTeamAgents(teamId);

  const currentTeam = ws.teams?.find((t) => t.id === teamId);
  const agentList = team.agents;
  const machineList = team.machines;
  const selected = agentList.find((a) => a.userId === selectedId) ?? null;

  async function close(a: Agent) {
    if (!confirm(`Close ${a.nickname || "this agent"}? Its live session ends.`))
      return;
    await team.close(a);
    if (selectedId === a.userId) navigate("/agents");
  }

  // The inverse of "use existing": stop serving this team, while other teams keep it.
  // Guarded to machines that serve more than one team — see the button.
  function unbind(m: Machine) {
    if (!confirm(`Stop using "${m.name}" in this team? Other teams keep it.`))
      return;
    void team.unbind(m);
  }

  return (
    <div className="flex h-full min-w-0 flex-1">
      {/* ---- list ---- */}
      <aside className="flex w-80 shrink-0 flex-col border-r">
        <header className="flex h-14 shrink-0 items-center gap-2 px-3">
          <Menu
            align="start"
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
          {teamId == null && (
            <div className="text-muted-foreground flex flex-col items-center gap-3 py-16 text-sm">
              <FolderGit2 className="size-10 opacity-50" />
              you have no teams yet
              <Button size="sm" onClick={() => navigate("/teams/manage")}>
                create a team
              </Button>
            </div>
          )}

          {teamId != null && (
            <>
              {/* machines */}
              <div className="px-3 pt-1">
                <div className="mb-1.5 flex items-center justify-between gap-2 px-1">
                  <h2 className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wide">
                    machines
                  </h2>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setAddDeviceDlg(true)}
                  >
                    <PlusCircle className="size-4" /> add device
                  </Button>
                </div>
                {team.machinesLoading && !team.machinesLoaded && <Loading />}
                {team.machinesError && (
                  <Alert variant="destructive">
                    <AlertDescription>{team.machinesError}</AlertDescription>
                  </Alert>
                )}
                {team.machinesLoaded && machineList.length === 0 && (
                  <p className="text-muted-foreground px-1 pb-1 text-xs">
                    no machines serve this team — use "add device".
                  </p>
                )}
                {machineList.length > 0 && (
                  <ul className="flex flex-col gap-0.5">
                    {machineList.map((m) => (
                      // px-2 and the dot LAST, both to match the agent rows below: their dot
                      // is the last thing inside a px-2 button, so anything after it here — the
                      // hover actions keep their width even while invisible — would push this
                      // one out of that column.
                      <li
                        key={m.id}
                        className="group hover:bg-accent/60 flex items-center gap-2 rounded-md px-2 py-1 text-sm"
                      >
                        <Server className="text-muted-foreground size-4 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">
                          {m.name}
                        </span>
                        <button
                          type="button"
                          onClick={() => setRenaming(m)}
                          className="text-muted-foreground hover:text-foreground shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100"
                          aria-label="rename machine"
                          title="rename"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        {/* Only offered while another team still has it:
                            unbinding the LAST team orphans the machine and the
                            backend then forgets it outright, which is not what
                            "remove from this team" looks like it does. */}
                        {m.teamIds.length > 1 && (
                          <button
                            type="button"
                            onClick={() => void unbind(m)}
                            className="text-muted-foreground hover:text-foreground shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100"
                            aria-label="remove machine from this team"
                            title="remove from this team"
                          >
                            <Unlink className="size-3.5" />
                          </button>
                        )}
                        <OnlineDot online={m.online} label={false} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* agents */}
              <div className="px-3 pt-4">
                <div className="mb-1.5 flex items-center justify-between gap-2 px-1">
                  <h2 className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wide">
                    agents
                  </h2>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setOpenDlg(true)}
                  >
                    <Bot className="size-4" /> open agent
                  </Button>
                </div>
                {team.agentsLoading && !team.agentsLoaded && <Loading />}
                {team.agentsError && (
                  <Alert variant="destructive">
                    <AlertDescription>{team.agentsError}</AlertDescription>
                  </Alert>
                )}
                {team.agentsLoaded && agentList.length === 0 && (
                  <div className="text-muted-foreground flex flex-col items-center gap-2 py-8 text-center text-sm">
                    <Bot className="size-8 opacity-50" />
                    no agents running
                    <Button size="sm" onClick={() => setOpenDlg(true)}>
                      <Bot className="size-4" /> open agent
                    </Button>
                  </div>
                )}
                {agentList.length > 0 && (
                  <ul className="flex flex-col gap-0.5">
                    {agentList.map((a) => (
                      <li
                        key={a.userId}
                        className={cn(
                          "flex items-center rounded-md",
                          a.userId === selectedId
                            ? "bg-accent"
                            : "hover:bg-accent/60",
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => navigate(`/agents/${a.userId}`)}
                          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-2 text-left"
                        >
                          <UserAvatar
                            userId={a.userId}
                            nickname={a.nickname}
                            avatarId={a.avatarId}
                            showMeta={false}
                            className="size-9"
                          />
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">
                            {a.nickname || `agent #${a.userId}`}
                          </span>
                          <OnlineDot online={a.online} label={false} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      </aside>

      {/* ---- detail ---- */}
      {selected ? (
        <AgentDetail
          key={selected.userId}
          agent={selected}
          machineName={machineLabel(selected.machineId, machineList)}
          onRename={() => setRenamingAgent(selected)}
          onChat={() => void team.chat(selected)}
          onClose={() => close(selected)}
          onAvatarChanged={team.reloadAgents}
        />
      ) : (
        <section className="text-muted-foreground flex min-w-0 flex-1 flex-col items-center justify-center gap-3">
          <Bot className="size-12 opacity-30" />
          <p className="text-sm">
            {selectedId != null
              ? "that agent is no longer open"
              : "select an agent, or open a new one"}
          </p>
          {teamId != null && (
            <Button size="sm" onClick={() => setOpenDlg(true)}>
              <Bot className="size-4" /> open agent
            </Button>
          )}
        </section>
      )}

      <OpenAgentDialog
        open={openDlg}
        onOpenChange={setOpenDlg}
        teams={ws.teams ?? []}
        initialTeamId={teamId}
        onOpened={(opened) => {
          team.reloadAgents();
          navigate(`/agents/${opened.agentUserId}`);
        }}
      />
      <AddDeviceDialog
        open={addDeviceDlg}
        onOpenChange={setAddDeviceDlg}
        teamId={teamId}
        onBound={team.reloadMachines}
      />
      {renaming && (
        <RenameMachineDialog
          key={renaming.id}
          machine={renaming}
          open
          onOpenChange={(o) => !o && setRenaming(null)}
          onRenamed={team.reloadMachines}
        />
      )}
      {renamingAgent && (
        <RenameAgentDialog
          key={renamingAgent.userId}
          agent={renamingAgent}
          open
          onOpenChange={(o) => !o && setRenamingAgent(null)}
          onRenamed={team.reloadAgents}
        />
      )}
    </div>
  );
}

function AgentDetail({
  agent: a,
  machineName,
  onRename,
  onChat,
  onClose,
  onAvatarChanged,
}: {
  agent: Agent;
  machineName?: string;
  onRename: () => void;
  onChat: () => void;
  onClose: () => void;
  onAvatarChanged: () => void;
}) {
  return (
    <section className="min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-5 p-10">
        {/* Same control as your own avatar, pointed at the agent — see ChangeAvatar. */}
        <ChangeAvatar
          className="size-24"
          target={{
            kind: "agent",
            userId: a.userId,
            nickname: a.nickname,
            avatarId: a.avatarId,
          }}
          onChanged={onAvatarChanged}
        />
        <div className="flex flex-col items-center gap-1 text-center">
          <h1 className="text-lg font-semibold">
            {a.nickname || `agent #${a.userId}`}
          </h1>
          <OnlineDot online={a.online} />
        </div>

        <dl className="bg-card w-full divide-y overflow-hidden rounded-lg border text-sm">
          <DetailRow label="user id" value={String(a.userId)} />
          {a.driver && <DetailRow label="driver" value={a.driver} />}
          {machineName && <DetailRow label="machine" value={machineName} />}
          {a.teamId != null && (
            <DetailRow label="team" value={String(a.teamId)} />
          )}
        </dl>

        <p className="text-muted-foreground text-center text-xs">
          click the avatar to watch its live screen
        </p>

        <AgentKeepaliveControl agent={a} onChanged={onAvatarChanged} />

        <div className="flex w-full flex-col gap-2">
          <Button onClick={onChat}>
            <MessageSquarePlus className="size-4" /> chat with agent
          </Button>
          <Button variant="secondary" onClick={onRename}>
            <Pencil className="size-4" /> rename
          </Button>
          <Button variant="destructive" onClick={onClose}>
            <Trash2 className="size-4" /> close agent
          </Button>
        </div>
      </div>
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="min-w-0 break-words text-right font-mono">{value}</dd>
    </div>
  );
}
