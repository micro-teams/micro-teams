/*
 * A team's machines and agents, and what can be done to an agent.
 *
 * useFleet(teamId) → { machines, agents, machineName(id), loaded, error } — refetched when the
 *   team's topic moves, answering its digest with "machines:online machines:agents".
 * useAgent(teamId, userId) → the agent from that team's fleet, or undefined once it has gone.
 * useAgentActions(teamId) → { rename(agent, nickname), close(agent), chatWith(agent) } — chatWith
 *   finds the one-to-one conversation with the agent, or starts one, and resolves with its id.
 *   Every action refetches the fleet and asks presence again.
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
    close: (agent: FleetAgent) => after(mt!.DELETE("/agent/{userId}", { params: { path: { userId: agent.userId } } })),
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
