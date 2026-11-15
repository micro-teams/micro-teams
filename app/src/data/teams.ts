/*
 * The teams the signed-in person belongs to, and which one the docs and agents sections look at.
 *
 * useTeams() → { teams, loaded, error } — every team, by name.
 * useTeam(teamId) → { team, members, loaded, error } — one team and its roster, owners first.
 * useTeamAdmin() → { create(name) → id, rename(id, name), remove(id), addMember(id, userId),
 *   setRole(id, userId, role), removeMember(id, userId) } — each refetches the team list and the
 *   roster it changed.
 * rememberedTeam(userId) / rememberTeam(userId, teamId) — the team last looked at, kept on the
 *   device per person, so the app opens on it again.
 * pickTeam(teams, current, remembered) — the team to look at: the current one while it still
 *   exists, else the remembered one, else the first; null when there are no teams.
 *
 * Example: const team = pickTeam(teams, nav.team, rememberedTeam(user.id));
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Schema } from "../api/client";
import { storage } from "../platform/storage";
import { useSession } from "./session";

export type Team = Schema["Team"];
export type TeamMember = Schema["TeamMember"];
export type Role = TeamMember["role"];
export const ROLES: readonly Role[] = ["OWNER", "ADMIN", "MEMBER"];

export function useTeams() {
  const { mt } = useSession();
  const q = useQuery({
    queryKey: ["teams"],
    enabled: !!mt,
    queryFn: async () => {
      const { data } = await mt!.GET("/team", { params: { query: { page_size: 100 } } });
      return [...(data?.teams ?? [])].sort((a, b) => a.name.localeCompare(b.name));
    },
  });
  return { teams: q.data ?? [], loaded: q.isSuccess, error: q.error };
}

export function useTeam(teamId: number) {
  const { mt } = useSession();
  const q = useQuery({
    queryKey: ["team", teamId],
    enabled: !!mt,
    queryFn: async () => (await mt!.GET("/team/{id}", { params: { path: { id: teamId } } })).data!,
  });
  const members = [...(q.data?.members ?? [])].sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role));
  return { team: q.data?.team, members, loaded: q.isSuccess, error: q.error };
}

export function useTeamAdmin() {
  const { mt } = useSession();
  const queries = useQueryClient();
  const after = async <T,>(teamId: number | null, call: Promise<T>) => {
    const out = await call;
    await Promise.all([
      queries.invalidateQueries({ queryKey: ["teams"] }),
      teamId === null ? null : queries.invalidateQueries({ queryKey: ["team", teamId] }),
    ]);
    return out;
  };
  return {
    create: async (name: string): Promise<number> => {
      const { data } = await after(null, mt!.POST("/team", { body: { name } }));
      if (!data) throw new Error("the server made a team but did not say which");
      return data.id;
    },
    rename: (id: number, name: string) => after(id, mt!.PATCH("/team/{id}", { params: { path: { id } }, body: { name } })),
    remove: (id: number) => after(id, mt!.DELETE("/team/{id}", { params: { path: { id } } })),
    addMember: (id: number, userId: number) =>
      after(id, mt!.POST("/team/{id}/members", { params: { path: { id } }, body: { userId, role: "MEMBER" } })),
    setRole: (id: number, userId: number, role: Role) =>
      after(id, mt!.PATCH("/team/{id}/members/{userId}", { params: { path: { id, userId } }, body: { role } })),
    removeMember: (id: number, userId: number) =>
      after(id, mt!.DELETE("/team/{id}/members/{userId}", { params: { path: { id, userId } } })),
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
