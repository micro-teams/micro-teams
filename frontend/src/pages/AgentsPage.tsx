// Agents — phone surface. Pick a team (shared workspace selection), see the
// machines that serve it and the agents currently open on them, open a new agent,
// talk to one, or close it. Reuses UserAvatar so every agent here carries its
// inference ring and click-to-现场 exactly like everywhere else in the app.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import {
  Bot,
  ChevronDown,
  FolderGit2,
  MessageSquarePlus,
  PlusCircle,
  Server,
  Settings2,
  Trash2,
} from "lucide-react";
import type { Agent } from "@/api";
import { agentApi, machineApi, mtCall } from "@/lib/mtApi";
import { startChatWithAgent } from "@/lib/agents";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useAsync, errMsg } from "@/hooks/useAsync";
import { useToast } from "@/hooks/useToast";
import { PageHeader } from "@/components/PageHeader";
import { UserAvatar } from "@/components/UserAvatar";
import {
  OpenAgentDialog,
  OnlineDot,
} from "@/components/agents/OpenAgentDialog";
import { AddDeviceDialog } from "@/components/agents/AddDeviceDialog";
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

  const machines = useAsync(
    () =>
      teamId != null
        ? mtCall(machineApi().listMachines({ teamId, pageSize: 100 }))
        : Promise.resolve(null),
    [teamId],
  );
  const agents = useAsync(
    () =>
      teamId != null
        ? mtCall(agentApi().listAgents({ teamId, pageSize: 100 }))
        : Promise.resolve(null),
    [teamId],
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
          <Button
            size="icon-sm"
            onClick={() => setOpenDlg(true)}
            disabled={teamId == null}
            aria-label="open agent"
          >
            <Bot className="size-4" />
          </Button>
        }
      />

      <div className="flex flex-col gap-6 p-3">
        {/* team switcher */}
        <Menu
          align="start"
          trigger={
            <button
              type="button"
              className="bg-secondary text-secondary-foreground flex max-w-full items-center gap-1.5 self-start rounded-md px-3 py-1.5 text-sm font-medium"
            >
              <FolderGit2 className="size-4 shrink-0" />
              <span className="truncate">
                {currentTeam?.name ?? "select team"}
              </span>
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
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* agents */}
            <section className="flex flex-col gap-2">
              <h2 className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
                agents
              </h2>
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
    </>
  );
}

function AgentRow({
  agent: a,
  onChat,
  onClose,
}: {
  agent: Agent;
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
          {a.machineId && <span className="truncate">· {a.machineId}</span>}
        </span>
      </div>
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
