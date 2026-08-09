// Agents — phone surface. Pick a team (shared workspace selection), see the
// machines that serve it and the agents currently open on them, open a new agent,
// talk to one, or close it. Reuses UserAvatar so every agent here carries its
// inference ring and click-to-watch exactly like everywhere else in the app.
import { useState } from "react";
import { useNavigate } from "react-router";
import {
  Bot,
  ChevronDown,
  FolderGit2,
  Info,
  MessageSquarePlus,
  Pencil,
  PlusCircle,
  Server,
  Settings2,
  Trash2,
} from "lucide-react";
import type { Agent, Machine } from "@/api";
import { machineLabel } from "@/lib/agents";
import { useTeamAgents } from "@/features/agents/useTeamAgents";
import { useWorkspace } from "@/hooks/useWorkspace";
import { PageHeader } from "@/components/PageHeader";
import { UserAvatar } from "@/components/UserAvatar";
import { ChangeAvatar } from "@/components/ChangeAvatar";
import {
  OpenAgentDialog,
  OnlineDot,
} from "@/features/agents/components/OpenAgentDialog";
import { AddDeviceDialog } from "@/features/agents/components/AddDeviceDialog";
import { MachineDetail } from "@/features/agents/components/MachineDetail";
import { RenameAgentDialog } from "@/features/agents/components/RenameAgentDialog";
import { AgentKeepaliveControl } from "@/features/agents/components/AgentKeepaliveControl";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import {
  Menu,
  MenuCheckItem,
  MenuItem,
  MenuSeparator,
} from "@/components/ui/menu";
import { Loading } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function AgentsPage() {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const teamId = ws.teamId;
  const [openDlg, setOpenDlg] = useState(false);
  const [addDeviceDlg, setAddDeviceDlg] = useState(false);
  const [infoMachine, setInfoMachine] = useState<Machine | null>(null);
  const [renamingAgent, setRenamingAgent] = useState<Agent | null>(null);
  const [infoAgent, setInfoAgent] = useState<Agent | null>(null);

  const team = useTeamAgents(teamId);

  const currentTeam = ws.teams?.find((t) => t.id === teamId);

  function close(a: Agent) {
    if (!confirm(`Close ${a.nickname || "this agent"}? Its live session ends.`))
      return;
    void team.close(a);
  }

  const agentList = team.agents;
  const machineList = team.machines;

  return (
    <>
      <PageHeader
        title="agents"
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

      <div className="flex flex-col gap-6 p-3">
        {teamId == null && (
          <div className="text-muted-foreground flex flex-col items-center gap-2 py-16 text-sm">
            <FolderGit2 className="size-8 opacity-50" />
            you have no teams yet
            <Button size="sm" onClick={() => navigate("/teams/manage")}>
              create a team
            </Button>
          </div>
        )}

        {teamId != null && (
          <>
            {/* machines */}
            <section className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
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
                <p className="text-muted-foreground rounded-lg border border-dashed px-3 py-4 text-sm">
                  no machines serve this team. use "add device" — either enrol a
                  new host, or add one you already have.
                </p>
              )}
              {machineList.length > 0 && (
                <ul className="divide-y overflow-hidden rounded-lg border">
                  {machineList.map((m) => (
                    // Same shape as an AgentRow — a leading 44px tile, then name over a meta
                    // line — so the machine's status dot lands at the same x as the agent's
                    // below it, and the two lists read as one column of live/dead. The whole
                    // row opens the machine; what used to be two icon buttons lives there now.
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => setInfoMachine(m)}
                        className="hover:bg-accent/60 flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm"
                      >
                        <span className="bg-muted flex size-11 shrink-0 items-center justify-center rounded-lg">
                          <Server className="text-muted-foreground size-5" />
                        </span>
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate font-medium">{m.name}</span>
                          <span className="text-muted-foreground flex items-center gap-2 text-xs">
                            <OnlineDot online={m.online} />
                          </span>
                        </div>
                        <Info className="text-muted-foreground size-4 shrink-0" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* agents */}
            <section className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
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
                <div className="text-muted-foreground flex flex-col items-center gap-2 py-10 text-sm">
                  <Bot className="size-8 opacity-50" />
                  no agents running — open one
                  <Button size="sm" onClick={() => setOpenDlg(true)}>
                    <Bot className="size-4" /> open agent
                  </Button>
                </div>
              )}
              {agentList.length > 0 && (
                <ul className="flex flex-col gap-2">
                  {agentList.map((a) => (
                    <AgentRow
                      key={a.userId}
                      agent={a}
                      machineName={machineLabel(a.machineId, machineList)}
                      onInfo={() => setInfoAgent(a)}
                    />
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>

      <OpenAgentDialog
        open={openDlg}
        onOpenChange={setOpenDlg}
        teams={ws.teams ?? []}
        initialTeamId={teamId}
        onOpened={team.reloadAgents}
      />
      <AddDeviceDialog
        open={addDeviceDlg}
        onOpenChange={setAddDeviceDlg}
        teamId={teamId}
        onBound={team.reloadMachines}
      />
      {infoMachine && (
        <Modal
          open
          onOpenChange={(o) => !o && setInfoMachine(null)}
          title="machine"
        >
          <MachineDetail
            key={infoMachine.id}
            machineId={infoMachine.id}
            teamId={teamId}
            teams={ws.teams ?? []}
            agents={agentList}
            onChanged={team.reloadMachines}
            onGone={() => setInfoMachine(null)}
            onOpenAgent={(a) => {
              setInfoMachine(null);
              setInfoAgent(a);
            }}
          />
        </Modal>
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
      {infoAgent && (
        <AgentInfoDialog
          onAvatarChanged={team.reloadAgents}
          key={infoAgent.userId}
          agent={infoAgent}
          machineName={machineLabel(infoAgent.machineId, machineList)}
          open
          onOpenChange={(o) => !o && setInfoAgent(null)}
          onRename={() => setRenamingAgent(infoAgent)}
          onChat={() => void team.chat(infoAgent)}
          onClose={() => close(infoAgent)}
        />
      )}
    </>
  );
}

// One agent, one action: tap the row's info button to open the detail modal, where
// rename / chat / close all live now. Keeping a single button per row is the whole
// point — the phone list stays uncluttered and every per-agent action is one place.
function AgentRow({
  agent: a,
  machineName,
  onInfo,
}: {
  agent: Agent;
  machineName?: string;
  onInfo: () => void;
}) {
  return (
    <li className="bg-card flex items-center gap-3 rounded-lg border px-3 py-2.5">
      <UserAvatar
        userId={a.userId}
        nickname={a.nickname}
        avatarId={a.avatarId}
        className="size-11"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">
          {a.nickname || `agent #${a.userId}`}
        </span>
        <span className="text-muted-foreground flex items-center gap-2 truncate text-xs">
          <OnlineDot online={a.online} />
          {a.driver && <span>· {a.driver}</span>}
          {machineName && <span className="truncate">· {machineName}</span>}
        </span>
      </div>
      <Button
        size="icon-sm"
        variant="ghost"
        onClick={onInfo}
        aria-label="agent info"
        title="info"
      >
        <Info className="size-4" />
      </Button>
    </li>
  );
}

// Agent detail on the phone — the desktop has a whole detail pane; the phone had no
// way at all to see an agent's driver / machine / team, so this is that view as a modal.
// The machine shows its NAME (resolved via machineLabel), not its opaque id.
function AgentInfoDialog({
  agent: a,
  machineName,
  open,
  onOpenChange,
  onRename,
  onChat,
  onClose,
  onAvatarChanged,
}: {
  agent: Agent;
  machineName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRename: () => void;
  onChat: () => void;
  onClose: () => void;
  onAvatarChanged: () => void;
}) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="agent info">
      <div className="flex flex-col items-center gap-4">
        {/* Same control as your own avatar, pointed at the agent — see ChangeAvatar. */}
        <ChangeAvatar
          className="size-20"
          target={{
            kind: "agent",
            userId: a.userId,
            nickname: a.nickname,
            avatarId: a.avatarId,
          }}
          onChanged={onAvatarChanged}
        />
        <div className="flex flex-col items-center gap-1 text-center">
          <span className="font-medium">
            {a.nickname || `agent #${a.userId}`}
          </span>
          <OnlineDot online={a.online} />
        </div>

        <dl className="bg-card w-full divide-y overflow-hidden rounded-lg border text-sm">
          <InfoRow label="user id" value={String(a.userId)} />
          {a.driver && <InfoRow label="driver" value={a.driver} />}
          {machineName && <InfoRow label="machine" value={machineName} />}
          {a.teamId != null && (
            <InfoRow label="team" value={String(a.teamId)} />
          )}
        </dl>

        <p className="text-muted-foreground text-center text-xs">
          tap the avatar to change its picture
        </p>

        <AgentKeepaliveControl agent={a} onChanged={onAvatarChanged} />

        {/* Every per-agent action lives here now — the phone row is just the info button. */}
        <div className="flex w-full flex-col gap-2">
          <Button
            onClick={() => {
              onOpenChange(false);
              onChat();
            }}
          >
            <MessageSquarePlus className="size-4" /> chat with agent
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              onOpenChange(false);
              onRename();
            }}
          >
            <Pencil className="size-4" /> rename
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              onOpenChange(false);
              onClose();
            }}
          >
            <Trash2 className="size-4" /> close agent
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 px-3 py-2.5">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="min-w-0 break-words text-right font-mono">{value}</dd>
    </div>
  );
}
