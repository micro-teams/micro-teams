/*
 * A team's machines and agents, and what can be done to an agent.
 *
 * useFleet(teamId) → { machines, agents, machineName(id), loaded, error } — refetched when the
 *   team's topic moves, answering its digest with "machines:online machines:agents".
 * useAgent(teamId, userId) → the agent from that team's fleet, or undefined once it has gone.
 * useAgentActions(teamId) → { rename(agent, nickname), close(agent), chatWith(agent), open(form),
 *   keepalive(agent, enabled, minutes) } —
 *   chatWith finds the one-to-one conversation with the agent, or starts one, and resolves with its
 *   id; open starts an agent on a machine (empty fields let the server decide) and resolves with
 *   the new agent's user id. Every action refetches the fleet and asks presence again.
 * useMachineActions() → { rename(machine, name), bind(machineId, teamId), unbind(machine,
 *   teamId), forget(machine) } — forget de-registers the machine for every team.
 * useDrivers() → { drivers, defaultDriver } — which drivers this deployment runs.
 * useApproveMachine() → approve(code, teamIds) — enrols the machine waiting with that one-time code
 *   into those teams; resolves with the machine.
 * useAllMachines() → every machine this person has, in any team: what "add device" can reuse.
 *
 * Example: const { agents } = useFleet(team); const { chatWith } = useAgentActions(team);
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Schema } from "../api/client";
import { useSession } from "./session";
import { useTopic } from "./topics";

export type Machine = Schema["Machine"];
export type FleetAgent = Schema["Agent"];

export const teamTopic = (id: number) => `team:${id}`;

export function useFleet(teamId: number | null) {
  const { mt } = useSession();
  const q = useQuery({
    queryKey: ["fleet", teamId],
    enabled: !!mt && teamId !== null,
    queryFn: async () => {
      const [m, a] = await Promise.all([
        mt!.GET("/machine", { params: { query: { teamId: teamId!, page_size: 100 } } }),
        mt!.GET("/agent", { params: { query: { teamId: teamId!, page_size: 100 } } }),
      ]);
      return { machines: m.data?.machines ?? [], agents: a.data?.agents ?? [] };
    },
  });
  const machines = q.data?.machines ?? [];
  const agents = q.data?.agents ?? [];
  useTopic(
    teamId === null ? null : teamTopic(teamId),
    () => void q.refetch(),
    () => (q.data ? `${machines.length}:${machines.filter((m) => m.online).length}:${agents.length}` : null),
  );
  return {
    machines,
    agents,
    machineName: (id?: string) => (id ? (machines.find((m) => m.id === id)?.name ?? id) : undefined),
    loaded: q.isSuccess,
    error: q.error,
  };
}

export function useDrivers() {
  const { mt } = useSession();
  const q = useQuery({
    queryKey: ["drivers"],
    enabled: !!mt,
    staleTime: Infinity,
    queryFn: async () => (await mt!.GET("/agent/drivers", {})).data ?? { drivers: [], defaultDriver: "" },
  });
  return q.data ?? { drivers: [], defaultDriver: "" };
}

export function useAllMachines() {
  const { mt } = useSession();
  const q = useQuery({
    queryKey: ["machines"],
    enabled: !!mt,
    queryFn: async () => (await mt!.GET("/machine", { params: { query: { page_size: 100 } } })).data?.machines ?? [],
  });
  return q.data ?? [];
}

export function useApproveMachine() {
  const { mt } = useSession();
  const queries = useQueryClient();
  return async (code: string, teamIds: number[]): Promise<Machine> => {
    const { data } = await mt!.POST("/machine/enroll/approve", { body: { code, teamIds } });
    await Promise.all([queries.invalidateQueries({ queryKey: ["fleet"] }), queries.invalidateQueries({ queryKey: ["machines"] })]);
    if (!data) throw new Error("the server approved the machine but did not say which");
    return data;
  };
}

export function useMachineActions() {
  const { mt } = useSession();
  const queries = useQueryClient();
  const after = async (call: Promise<unknown>) => {
    await call;
    await Promise.all([queries.invalidateQueries({ queryKey: ["fleet"] }), queries.invalidateQueries({ queryKey: ["machines"] })]);
  };
  return {
    rename: (m: Machine, name: string) => after(mt!.PATCH("/machine/{id}", { params: { path: { id: m.id } }, body: { name: name.trim() } })),
    bind: (machineId: string, team: number) => after(mt!.POST("/team/{id}/machine", { params: { path: { id: team } }, body: { machineId } })),
    unbind: (m: Machine, team: number) => after(mt!.DELETE("/team/{id}/machine/{machineId}", { params: { path: { id: team, machineId: m.id } } })),
    forget: (m: Machine) => after(mt!.DELETE("/machine/{id}", { params: { path: { id: m.id } } })),
  };
}

export function useAgent(teamId: number | null, userId: number) {
  return useFleet(teamId).agents.find((a) => a.userId === userId);
}

export function useAgentActions(teamId: number | null) {
  const { mt, presence } = useSession();
  const queries = useQueryClient();
  const after = async <T,>(call: Promise<T>) => {
    const out = await call;
    await queries.invalidateQueries({ queryKey: ["fleet", teamId] });
    presence.refresh();
    return out;
  };
  return {
    rename: (agent: FleetAgent, nickname: string) =>
      after(mt!.PUT("/agent/{userId}/nickname", { params: { path: { userId: agent.userId } }, body: { nickname: nickname.trim() } })),
    keepalive: (agent: FleetAgent, enabled: boolean, minutes: number) =>
      after(
        mt!.PUT("/agent/{userId}/keepalive", {
          params: { path: { userId: agent.userId } },
          body: { enabled, intervalSeconds: Math.round(minutes * 60) },
        }),
      ),
    close: (agent: FleetAgent) => after(mt!.DELETE("/agent/{userId}", { params: { path: { userId: agent.userId } } })),
    open: async (form: { machineId: string; nickname?: string; driver?: string; cwd?: string }): Promise<number> => {
      const blank = (v?: string) => (v?.trim() ? v.trim() : undefined);
      const { data } = await after(
        mt!.POST("/agent", {
          body: { machineId: form.machineId, teamId: teamId!, nickname: blank(form.nickname), driver: blank(form.driver), cwd: blank(form.cwd), resume: false },
        }),
      );
      if (!data) throw new Error("the server opened an agent but did not say which");
      return data.agentUserId;
    },
    chatWith: async (agent: FleetAgent): Promise<number> => {
      const { data } = await mt!.GET("/chat", { params: { query: { page_size: 100 } } });
      const existing = (data?.chats ?? []).find((c) => c.members.length === 2 && c.members.some((m) => m.userId === agent.userId));
      if (existing) return existing.id;
      const created = await mt!.POST("/chat", {
        body: { title: agent.nickname || `agent #${agent.userId}`, memberIds: [agent.userId] },
      });
      if (!created.data) throw new Error("the server created a conversation but did not say which");
      await queries.invalidateQueries({ queryKey: ["chats"] });
      return created.data.id;
    },
  };
}
