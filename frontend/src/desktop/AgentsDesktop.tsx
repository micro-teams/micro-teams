// Agents — desktop master-detail. Left: team switcher + the machines that serve
// it + the agents open on them (selectable). Right: the selected agent — a big
// avatar (click it for 现场, same as everywhere), its live status/driver/machine,
// and the two things a human needs, "chat with it" (creates a thread including the
// agent and jumps to it) and "close it". Selection lives in the URL (/agents/:id)
// so deep links and the browser back button work; the rail switches sections.
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useSectionLocation } from "@/desktop/sectionKeepAlive";
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
import { cn } from "@/lib/utils";

export function AgentsDesktop() {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const location = useSectionLocation();
  const toast = useToast();
  const teamId = ws.teamId;
  const [openDlg, setOpenDlg] = useState(false);
  const [addDeviceDlg, setAddDeviceDlg] = useState(false);

  const selectedId = useMemo(() => {
    const m = location.pathname.match(/^\/agents\/(\d+)/);
    return m ? Number(m[1]) : null;
  }, [location.pathname]);

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

  useEffect(() => {
    const t = setInterval(() => {
      agents.reload();
      machines.reload();
    }, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  const currentTeam = ws.teams?.find((t) => t.id === teamId);
  const agentList = agents.data?.agents ?? [];
  const machineList = machines.data?.machines ?? [];
  const selected = agentList.find((a) => a.userId === selectedId) ?? null;

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
      if (selectedId === a.userId) navigate("/agents");
    } catch (err) {
      toast.error(errMsg(err));
    }
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
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setOpenDlg(true)}
            disabled={teamId == null}
            className="text-foreground hover:bg-accent flex size-8 items-center justify-center rounded-md disabled:opacity-40"
            aria-label="open agent"
            title="open agent"
          >
            <Bot className="size-5" />
          </button>
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
                  <button
                    type="button"
                    onClick={() => setAddDeviceDlg(true)}
                    className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-[11px] font-medium"
                    title="add device"
                  >
                    <PlusCircle className="size-3.5" /> add
                  </button>
                </div>
                {machines.loading && !machines.data && <Loading />}
                {machines.error && (
                  <Alert variant="destructive">
                    <AlertDescription>{machines.error}</AlertDescription>
                  </Alert>
                )}
                {machines.data && machineList.length === 0 && (
                  <p className="text-muted-foreground px-1 pb-1 text-xs">
                    no machines serve this team.
                  </p>
                )}
                {machineList.length > 0 && (
                  <ul className="flex flex-col gap-0.5">
                    {machineList.map((m) => (
                      <li
                        key={m.id}
                        className="flex items-center gap-2 rounded-md px-1 py-1 text-sm"
                      >
                        <Server className="text-muted-foreground size-4 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">
                          {m.name}
                        </span>
                        <OnlineDot online={m.online} label={false} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* agents */}
              <div className="px-3 pt-4">
                <h2 className="text-muted-foreground mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide">
                  agents
                </h2>
                {agents.loading && !agents.data && <Loading />}
                {agents.error && (
                  <Alert variant="destructive">
                    <AlertDescription>{agents.error}</AlertDescription>
                  </Alert>
                )}
                {agents.data && agentList.length === 0 && (
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
                      <li key={a.userId}>
                        <button
                          type="button"
                          onClick={() => navigate(`/agents/${a.userId}`)}
                          className={cn(
                            "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left",
                            a.userId === selectedId
                              ? "bg-accent"
                              : "hover:bg-accent/60",
                          )}
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
          onChat={() => chat(selected)}
          onClose={() => close(selected)}
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
          agents.reload();
          navigate(`/agents/${opened.agentUserId}`);
        }}
      />
      <AddDeviceDialog open={addDeviceDlg} onOpenChange={setAddDeviceDlg} />
    </div>
  );
}

function AgentDetail({
  agent: a,
  onChat,
  onClose,
}: {
  agent: Agent;
  onChat: () => void;
  onClose: () => void;
}) {
  return (
    <section className="min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-5 p-10">
        <UserAvatar
          userId={a.userId}
          nickname={a.nickname}
          avatarId={a.avatarId}
          className="size-24"
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
          {a.machineId && <DetailRow label="machine" value={a.machineId} />}
          {a.teamId != null && (
            <DetailRow label="team" value={String(a.teamId)} />
          )}
        </dl>

        <p className="text-muted-foreground text-center text-xs">
          click the avatar to watch its 现场 (live screen)
        </p>

        <div className="flex w-full flex-col gap-2">
          <Button onClick={onChat}>
            <MessageSquarePlus className="size-4" /> chat with agent
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
