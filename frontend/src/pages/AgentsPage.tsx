// Agents — phone surface. Pick a team (shared workspace selection), see the
// machines that serve it and the agents currently open on them, open a new agent,
// talk to one, or close it. Reuses UserAvatar so every agent here carries its
// inference ring and click-to-watch exactly like everywhere else in the app.
import { useEffect, useState } from "react";
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
import { agentApi, machineApi, mtCall } from "@/lib/mtApi";
import { startChatWithAgent, machineLabel } from "@/lib/agents";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useAsync, errMsg } from "@/hooks/useAsync";
import { useToast } from "@/hooks/useToast";
import { PageHeader } from "@/components/PageHeader";
import { UserAvatar } from "@/components/UserAvatar";
import { ChangeAvatar } from "@/components/ChangeAvatar";
import {
  OpenAgentDialog,
  OnlineDot,
} from "@/components/agents/OpenAgentDialog";
import { AddDeviceDialog } from "@/components/agents/AddDeviceDialog";
import { RenameMachineDialog } from "@/components/agents/RenameMachineDialog";
import { RenameAgentDialog } from "@/components/agents/RenameAgentDialog";
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
  const toast = useToast();
  const teamId = ws.teamId;
  const [openDlg, setOpenDlg] = useState(false);
  const [addDeviceDlg, setAddDeviceDlg] = useState(false);
  const [renaming, setRenaming] = useState<Machine | null>(null);
  const [renamingAgent, setRenamingAgent] = useState<Agent | null>(null);
  const [infoAgent, setInfoAgent] = useState<Agent | null>(null);

  const machines = useAsync(
    () =>
      teamId != null
        ? mtCall(machineApi().listMachines({ teamId, pageSize: 100 }))
        : Promise.resolve(null),
    [teamId],
    teamId != null ? `machines:${teamId}` : undefined,
  );
  const agents = useAsync(
    () =>
      teamId != null
        ? mtCall(agentApi().listAgents({ teamId, pageSize: 100 }))
        : Promise.resolve(null),
    [teamId],
    teamId != null ? `agents:${teamId}` : undefined,
  );

  // Keep live status fresh — agents open, go busy, and close out of band.
  useEffect(() => {
    const t = setInterval(() => {
      agents.reload();
      machines.reload();
    }, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  const currentTeam = ws.teams?.find((t) => t.id === teamId);

  async function chat(a: Agent) {
    try {
      const id = await startChatWithAgent(a);
      navigate(`/chats/${id}`);
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  async function close(a: Agent) {
    if (!confirm(`Close ${a.nickname || "this agent"}? Its live session ends.`))
      return;
    try {
      await mtCall(agentApi().closeAgent({ userId: a.userId }));
      toast.success("agent closed");
      agents.reload();
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  const agentList = agents.data?.agents ?? [];
  const machineList = machines.data?.machines ?? [];

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
              {machines.loading && !machines.data && <Loading />}
              {machines.error && (
                <Alert variant="destructive">
                  <AlertDescription>{machines.error}</AlertDescription>
                </Alert>
              )}
              {machines.data && machineList.length === 0 && (
                <p className="text-muted-foreground rounded-lg border border-dashed px-3 py-4 text-sm">
                  no machines serve this team. enroll a host with the CLI, then
                  approve it in team management.
                </p>
              )}
              {machineList.length > 0 && (
                <ul className="divide-y overflow-hidden rounded-lg border">
                  {machineList.map((m) => (
                    <li
                      key={m.id}
                      className="flex items-center gap-3 px-3 py-2.5 text-sm"
                    >
                      <Server className="text-muted-foreground size-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{m.name}</span>
                      <OnlineDot online={m.online} />
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => setRenaming(m)}
                        aria-label="rename machine"
                        title="rename"
                      >
                        <Pencil className="size-4" />
                      </Button>
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
              {agents.loading && !agents.data && <Loading />}
              {agents.error && (
                <Alert variant="destructive">
                  <AlertDescription>{agents.error}</AlertDescription>
                </Alert>
              )}
              {agents.data && agentList.length === 0 && (
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
                      onRename={() => setRenamingAgent(a)}
                      onChat={() => chat(a)}
                      onClose={() => close(a)}
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
        onOpened={() => agents.reload()}
      />
      <AddDeviceDialog open={addDeviceDlg} onOpenChange={setAddDeviceDlg} />
      {renaming && (
        <RenameMachineDialog
          key={renaming.id}
          machine={renaming}
          open
          onOpenChange={(o) => !o && setRenaming(null)}
          onRenamed={() => machines.reload()}
        />
      )}
      {renamingAgent && (
        <RenameAgentDialog
          key={renamingAgent.userId}
          agent={renamingAgent}
          open
          onOpenChange={(o) => !o && setRenamingAgent(null)}
          onRenamed={() => agents.reload()}
        />
      )}
      {infoAgent && (
        <AgentInfoDialog
          onAvatarChanged={() => agents.reload()}
          key={infoAgent.userId}
          agent={infoAgent}
          machineName={machineLabel(infoAgent.machineId, machineList)}
          open
          onOpenChange={(o) => !o && setInfoAgent(null)}
          onChat={() => chat(infoAgent)}
        />
      )}
    </>
  );
}

function AgentRow({
  agent: a,
  machineName,
  onInfo,
  onRename,
  onChat,
  onClose,
}: {
  agent: Agent;
  machineName?: string;
  onInfo: () => void;
  onRename: () => void;
  onChat: () => void;
  onClose: () => void;
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
      <Button
        size="icon-sm"
        variant="ghost"
        onClick={onRename}
        aria-label="rename agent"
        title="rename"
      >
        <Pencil className="size-4" />
      </Button>
      <Button
        size="icon-sm"
        variant="secondary"
        onClick={onChat}
        aria-label="chat with agent"
        title="chat"
      >
        <MessageSquarePlus className="size-4" />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        onClick={onClose}
        aria-label="close agent"
        title="close agent"
        className="text-destructive"
      >
        <Trash2 className="size-4" />
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
  onChat,
  onAvatarChanged,
}: {
  agent: Agent;
  machineName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChat: () => void;
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

        <Button
          className="w-full"
          onClick={() => {
            onOpenChange(false);
            onChat();
          }}
        >
          <MessageSquarePlus className="size-4" /> chat with agent
        </Button>
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
