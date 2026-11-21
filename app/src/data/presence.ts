/*
 * Which of the people on screen are agents, whether each is online and working, and whether its
 * live screen can be watched.
 *
 * usePresence(userId) → { agent, working, watchable } — agent is undefined for anyone who is not
 *   an agent (or not yet known).
 * isWorking(agent) — busy, starting or compacting: what draws the ring.
 *
 * Agent — the API's own shape for an agent, as presence knows it.
 *
 * Example: const { agent, working } = usePresence(7);
 *
 * Every avatar reads the same live request, the list of agents: being in it is being an agent, and
 * an agent's online state and status change on every face at once.
 */
import { useMemo } from "react";
import type { Schema } from "../api/client";
import { livePath, useLive } from "./live";

export type Agent = Schema["Agent"];

const ALL_AGENTS = livePath("/agent", { page_size: 1000 });

export function isWorking(agent: Agent | undefined): boolean {
  const status = agent?.vars?.status;
  return status === "busy" || status === "starting" || status === "compacting";
}

export function usePresence(userId: number | undefined) {
  const { data } = useLive<Schema["ListAgentsResponse"]>(userId === undefined ? null : ALL_AGENTS);
  const byId = useMemo(() => new Map((data?.agents ?? []).map((a) => [a.userId, a])), [data]);
  const agent = userId === undefined ? undefined : byId.get(userId);
  return { agent, working: isWorking(agent), watchable: !!agent?.online && !!agent.sid };
}
