/*
 * Teams: the ones the signed-in person belongs to, and everything one team holds.
 *
 * useTeams() → { teams, loaded, error } — the teams the person is a member of, by name (the team
 *   picker; teams reached only by being inside one of these are not in it).
 * useTeam(teamId) → { team, members, parents, subteams, isMember, loaded, error } — one team, its
 *   members (people and agents, with names), the teams it is inside, the teams inside it, and
 *   whether the person is a member or reaches it through a parent.
 * useTeamChats(teamId) → { chats, loaded } — the team's chats, whether or not the person is in them.
 * useTeamAdmin() → { create(name, parentId?) → id, rename(id, name), remove(id), addMember(id,
 *   userId), removeMember(id, userId), addSubteam(id, childId), removeSubteam(id, childId),
 *   addChat(id, threadId), createChat(id, title) → thread id, removeChat(id, threadId),
 *   addMachine(id, machineId), removeMachine(id, machineId) } — anyone who can access a team may do
 *   each; the server refuses what the model does not allow, with its reason.
 * rememberedTeam(userId) / rememberTeam(userId, teamId) — the team last looked at, kept on the
 *   device per person, so the app opens on it again.
 * pickTeam(teams, current, remembered) — the team to look at: the current one while it still
 *   exists, else the remembered one, else the first; null when there are no teams.
 *
 * Team, TeamMember — the API's own shapes.
 *
 * Example: const team = pickTeam(teams, nav.team, rememberedTeam(user.id));
 */
import { useMemo } from "react";
import type { Schema } from "../api/client";
import { livePath, useLive } from "./live";
import { storage } from "../platform/storage";
import { useSession } from "./session";

export type Team = Schema["Team"];
export type TeamMember = Schema["TeamMember"];

export function useTeams() {
  const { data, loaded, status } = useLive<Schema["ListTeamsResponse"]>(livePath("/team", { page_size: 200 }));
  const teams = useMemo(() => [...(data?.teams ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [data]);
  return { teams, loaded, error: status !== undefined && status !== 200 ? new Error(`teams: ${status}`) : null };
}

export function useTeam(teamId: number | null) {
  const { data, loaded, status } = useLive<Schema["TeamDetail"]>(teamId === null ? null : `/team/${teamId}`);
  return {
    team: data?.team,
    members: data?.members ?? [],
    parents: data?.parents ?? [],
    subteams: data?.subteams ?? [],
    isMember: data?.isMember ?? false,
    loaded,
    error: status !== undefined && status !== 200 ? new Error(`team: ${status}`) : null,
  };
}

export function useTeamChats(teamId: number | null) {
  const { data, loaded } = useLive<Schema["ListChatsResponse"]>(
    teamId === null ? null : livePath(`/team/${teamId}/chats`, { queryIsMemberAgent: true }),
  );
  return { chats: data?.chats ?? [], loaded };
}

export function useTeamAdmin() {
  const { mt } = useSession();
  const must = async <T,>(call: Promise<{ data?: T; error?: unknown }>): Promise<T | undefined> => {
    const r = await call;
    if (r.error) throw new Error((r.error as { message?: string }).message ?? "the server refused");
    return r.data;
  };
  return {
    create: async (name: string, parentId?: number): Promise<number> => {
      const data = await must(mt!.POST("/team", { body: { name, parentId } }));
      if (!data) throw new Error("the server made a team but did not say which");
      return data.id;
    },
    rename: (id: number, name: string) => must(mt!.PATCH("/team/{id}", { params: { path: { id } }, body: { name } })),
    remove: (id: number) => must(mt!.DELETE("/team/{id}", { params: { path: { id } } })),
    addMember: (id: number, userId: number) => must(mt!.POST("/team/{id}/members", { params: { path: { id } }, body: { userId } })),
    removeMember: (id: number, userId: number) =>
      must(mt!.DELETE("/team/{id}/members/{userId}", { params: { path: { id, userId } } })),
    addSubteam: (id: number, childId: number) =>
      must(mt!.POST("/team/{id}/subteams", { params: { path: { id } }, body: { teamId: childId } })),
    removeSubteam: (id: number, childId: number) =>
      must(mt!.DELETE("/team/{id}/subteams/{childId}", { params: { path: { id, childId } } })),
    addChat: (id: number, threadId: number) => must(mt!.POST("/team/{id}/chats", { params: { path: { id } }, body: { threadId } })),
    createChat: async (id: number, title: string): Promise<number> => {
      const data = await must(mt!.POST("/team/{id}/chats", { params: { path: { id } }, body: { title } }));
      return data!.id;
    },
    removeChat: (id: number, threadId: number) =>
      must(mt!.DELETE("/team/{id}/chats/{threadId}", { params: { path: { id, threadId } } })),
    addMachine: (id: number, machineId: string) =>
      must(mt!.POST("/team/{id}/machine", { params: { path: { id } }, body: { machineId } })),
    removeMachine: (id: number, machineId: string) =>
      must(mt!.DELETE("/team/{id}/machine/{machineId}", { params: { path: { id, machineId } } })),
  };
}

export function rememberedTeam(userId: number): number | null {
  const v = storage.get(`team:${userId}`);
  return v ? Number(v) : null;
}

export function rememberTeam(userId: number, teamId: number) {
  storage.set(`team:${userId}`, String(teamId));
}

export function pickTeam(teams: readonly Team[], current: number | null, remembered: number | null): number | null {
  const has = (id: number | null) => id !== null && teams.some((t) => t.id === id);
  if (has(current)) return current;
  if (has(remembered)) return remembered;
  return teams[0]?.id ?? null;
}
