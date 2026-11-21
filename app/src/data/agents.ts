/*
 * Machines and agents: a team's, one machine's terminals, and what can be done to each.
 *
 * useFleet(teamId) → { machines, agents, machineName(id), loaded, error } — the team's machines and
 *   agents (live: online, a screen starting or stopping and an agent's status all show at once).
 * useAgent(teamId, userId) → the agent from that team's fleet, or undefined once it has gone.
 * useAgentActions(teamId) → { rename(agent, nickname), close(agent), chatWith(agent), open(form),
 *   keepalive(agent, enabled, minutes), setLlm(agent, settings), reboot(agent) } — chatWith resolves
 *   with the agent's own chat (the one of its name), or a new one-to-one when it has none; open
 *   starts an agent on a machine in the team (empty fields let the server decide) and resolves with
 *   the new agent's user id.
 * useMachineActions() → { rename(machine, name), bind(machineId, teamId), unbind(machine, teamId),
 *   forget(machine) } — forget de-registers the machine everywhere.
 * useTerminals(machineId) → { terminals, loaded } — the machine's terminals and commands, oldest first.
 * useTerminalActions(machineId) → { open() → sid, run(command) → sid, close(sid) } — open starts a
 *   login shell, run one command; both are watched in the live screen by their sid.
 * useDrivers() → { drivers, defaultDriver } — which drivers this deployment runs.
 * useApproveMachine() → approve(code, teamIds) — enrols the machine waiting with that one-time code
 *   into those teams; resolves with the machine.
 * useAllMachines() → every machine this person can use, in any team: what "add device" can reuse.
 *
 * Machine, FleetAgent, LlmSettings, Terminal — the API's own shapes, named for the screens.
 *
 * Example: const { agents } = useFleet(team); const { chatWith } = useAgentActions(team);
 *
 * Reads are live requests (data/live.ts); writes are plain requests whose effect the reads show
 * by themselves.
 */
import type { Schema } from "../api/client";
import { livePath, useLive } from "./live";
import { useSession } from "./session";

export type Machine = Schema["Machine"];
export type FleetAgent = Schema["Agent"];
export type LlmSettings = Schema["AgentLlmSettings"];
export type Terminal = Schema["Terminal"];

export function useFleet(teamId: number | null) {
  const m = useLive<Schema["ListMachinesResponse"]>(teamId === null ? null : livePath("/machine", { teamId, page_size: 100 }));
  const a = useLive<Schema["ListAgentsResponse"]>(teamId === null ? null : livePath("/agent", { teamId, page_size: 100 }));
  const machines = m.data?.machines ?? [];
  const agents = a.data?.agents ?? [];
  const bad = [m.status, a.status].find((s) => s !== undefined && s !== 200);
  return {
    machines,
    agents,
    machineName: (id?: string) => (id ? (machines.find((x) => x.id === id)?.name ?? id) : undefined),
    loaded: m.loaded && a.loaded,
    error: bad ? new Error(`fleet: ${bad}`) : null,
  };
}

export function useDrivers() {
  const { data } = useLive<Schema["AgentDrivers"]>("/agent/drivers");
  return data ?? { drivers: [], defaultDriver: "" };
}

export function useAllMachines() {
  const { data } = useLive<Schema["ListMachinesResponse"]>(livePath("/machine", { page_size: 100 }));
  return data?.machines ?? [];
}

export function useTerminals(machineId: string | null) {
  const { data, loaded } = useLive<Schema["ListTerminalsResponse"]>(machineId ? `/machine/${encodeURIComponent(machineId)}/terminal` : null);
  return { terminals: data?.terminals ?? [], loaded };
}

export function useTerminalActions(machineId: string) {
  const { mt } = useSession();
  const open = async (command?: string): Promise<string> => {
    const { data, error } = await mt!.POST("/machine/{id}/terminal", { params: { path: { id: machineId } }, body: { command } });
    if (!data) throw new Error((error as { message?: string } | undefined)?.message ?? "the machine did not open a terminal");
    return data.sid;
  };
  return {
    open: () => open(),
    run: (command: string) => open(command),
    close: (sid: string) => mt!.DELETE("/machine/{id}/terminal/{sid}", { params: { path: { id: machineId, sid } } }),
  };
}

export function useApproveMachine() {
  const { mt } = useSession();
  return async (code: string, teamIds: number[]): Promise<Machine> => {
    const { data } = await mt!.POST("/machine/enroll/approve", { body: { code, teamIds } });
    if (!data) throw new Error("the server approved the machine but did not say which");
    return data;
  };
}

export function useMachineActions() {
  const { mt } = useSession();
  return {
    rename: (m: Machine, name: string) => mt!.PATCH("/machine/{id}", { params: { path: { id: m.id } }, body: { name: name.trim() } }),
    bind: (machineId: string, team: number) => mt!.POST("/team/{id}/machine", { params: { path: { id: team } }, body: { machineId } }),
    unbind: (m: Machine, team: number) =>
      mt!.DELETE("/team/{id}/machine/{machineId}", { params: { path: { id: team, machineId: m.id } } }),
    forget: (m: Machine) => mt!.DELETE("/machine/{id}", { params: { path: { id: m.id } } }),
  };
}

export function useAgent(teamId: number | null, userId: number) {
  return useFleet(teamId).agents.find((a) => a.userId === userId);
}

export function useAgentActions(teamId: number | null) {
  const { mt } = useSession();
  return {
    rename: (agent: FleetAgent, nickname: string) =>
      mt!.PUT("/agent/{userId}/nickname", { params: { path: { userId: agent.userId } }, body: { nickname: nickname.trim() } }),
    keepalive: (agent: FleetAgent, enabled: boolean, minutes: number) =>
      mt!.PUT("/agent/{userId}/keepalive", {
        params: { path: { userId: agent.userId } },
        body: { enabled, intervalSeconds: Math.round(minutes * 60) },
      }),
    setLlm: (agent: FleetAgent, settings: LlmSettings) =>
      mt!.PUT("/agent/{userId}/llm", { params: { path: { userId: agent.userId } }, body: settings }),
    reboot: (agent: FleetAgent) => mt!.POST("/agent/{userId}/reboot", { params: { path: { userId: agent.userId } } }),
    close: (agent: FleetAgent) => mt!.DELETE("/agent/{userId}", { params: { path: { userId: agent.userId } } }),
    open: async (form: { machineId: string; nickname?: string; driver?: string; cwd?: string; llm?: LlmSettings }): Promise<number> => {
      const blank = (v?: string) => (v?.trim() ? v.trim() : undefined);
      const { data } = await mt!.POST("/agent", {
        body: {
          machineId: form.machineId,
          teamId: teamId!,
          nickname: blank(form.nickname),
          driver: blank(form.driver),
          cwd: blank(form.cwd),
          resume: false,
          llm: form.llm && form.llm.provider !== "none" ? form.llm : undefined,
        },
      });
      if (!data) throw new Error("the server opened an agent but did not say which");
      return data.agentUserId;
    },
    chatWith: async (agent: FleetAgent): Promise<number> => {
      const own = agent.chats?.find((c) => c.title === agent.nickname) ?? agent.chats?.[0];
      if (own) return own.id;
      const created = await mt!.POST("/chat", {
        body: { title: agent.nickname || `agent #${agent.userId}`, memberIds: [agent.userId] },
      });
      if (!created.data) throw new Error("the server created a conversation but did not say which");
      return created.data.id;
    },
  };
}
