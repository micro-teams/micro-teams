/*
 * The teams the signed-in person belongs to, and which one the docs and agents sections look at.
 *
 * useTeams() → { teams, loaded, error } — every team, by name.
 * rememberedTeam(userId) / rememberTeam(userId, teamId) — the team last looked at, kept on the
 *   device per person, so the app opens on it again.
 * pickTeam(teams, current, remembered) — the team to look at: the current one while it still
 *   exists, else the remembered one, else the first; null when there are no teams.
 *
 * Example: const team = pickTeam(teams, nav.team, rememberedTeam(user.id));
 */
import { useQuery } from "@tanstack/react-query";
import type { Schema } from "../api/client";
import { storage } from "../platform/storage";
import { useSession } from "./session";

export type Team = Schema["Team"];

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
