// A team's machines and the agents running on them, plus the things you do to them.
//
// Both shells fetched both lists, polled both on their own timer, and each implemented close,
// unbind and "start a chat with this agent" separately. The lists are the same question either way;
// only the arrangement differs.
import { useCallback, useEffect } from "react";
import { useNavigate } from "react-router";
import type { Agent, Machine } from "@/api";
import { agentApi, machineApi, teamApi, mtCall } from "@/lib/mtApi";
import { useAsync, errMsg } from "@/hooks/useAsync";
import { useToast } from "@/hooks/useToast";
import { startChatWithAgent } from "@/lib/agents";

/** Agents open, go busy and close out of band, so the lists are refreshed on a timer (T-065). */
const POLL_MS = 4000;

export interface TeamAgents {
  machines: Machine[];
  agents: Agent[];
  machinesLoading: boolean;
  agentsLoading: boolean;
  machinesLoaded: boolean;
  agentsLoaded: boolean;
  machinesError: string | null;
  agentsError: string | null;
  reloadMachines: () => void;
  reloadAgents: () => void;
  /** Close an agent's session. Confirmation belongs to the caller. */
  close: (agent: Agent) => Promise<void>;
  /** Open (or find) the chat with this agent and navigate to it. */
  chat: (agent: Agent) => Promise<void>;
  /** Stop this team using a machine. Only safe while another team still holds it — see below. */
  unbind: (machine: Machine) => Promise<void>;
}

export function useTeamAgents(teamId: number | null): TeamAgents {
  const navigate = useNavigate();
  const toast = useToast();

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

  const reloadMachines = machines.reload;
  const reloadAgents = agents.reload;
  useEffect(() => {
    const t = setInterval(() => {
      reloadAgents();
      reloadMachines();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [reloadAgents, reloadMachines]);

  const close = useCallback(
    async (agent: Agent) => {
      try {
        await mtCall(agentApi().closeAgent({ userId: agent.userId }));
        toast.success("agent closed");
        reloadAgents();
      } catch (err) {
        toast.error(errMsg(err));
      }
    },
    [toast, reloadAgents],
  );

  const chat = useCallback(
    async (agent: Agent) => {
      try {
        const id = await startChatWithAgent(agent);
        navigate(`/chats/${id}`);
      } catch (err) {
        toast.error(errMsg(err));
      }
    },
    [navigate, toast],
  );

  // Unbinding the LAST team orphans the machine, and the backend then forgets it outright — so the
  // surfaces only offer this while `machine.teamIds.length > 1`. That guard is theirs to render;
  // this is only the call.
  const unbind = useCallback(
    async (machine: Machine) => {
      if (teamId == null) return;
      try {
        await mtCall(
          teamApi().unbindTeamMachine({ id: teamId, machineId: machine.id }),
        );
        toast.success("machine removed from this team");
        reloadMachines();
      } catch (err) {
        toast.error(errMsg(err));
      }
    },
    [teamId, toast, reloadMachines],
  );

  return {
    machines: machines.data?.machines ?? [],
    agents: agents.data?.agents ?? [],
    machinesLoading: machines.loading,
    agentsLoading: agents.loading,
    machinesLoaded: machines.data != null,
    agentsLoaded: agents.data != null,
    machinesError: machines.error,
    agentsError: agents.error,
    reloadMachines,
    reloadAgents,
    close,
    chat,
    unbind,
  };
}
