// Workspace state that must survive tab switches (teams → chats → me → teams)
// without changing. React Router unmounts the tab page on every switch, so this
// state lives in a provider mounted ABOVE the tab routes: the selected team, the
// set of expanded folders, the scroll position, and a cache of each team's doc
// tree (so returning to the teams tab shows the exact same thing, no reload
// flash). Only the selected team is persisted across full reloads (localStorage).
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Outlet } from "react-router";
import type { DocNode, Team } from "@/api";
import { mtCall, teamApi } from "@/lib/mtApi";

const TEAM_KEY = "microteams.teamId";

interface WorkspaceState {
  teams: Team[] | null;
  teamsError: string | null;
  teamsLoading: boolean;
  reloadTeams: () => Promise<Team[]>;

  teamId: number | null;
  setTeamId: (id: number | null) => void;

  treeFor: (teamId: number) => DocNode | undefined;
  setTree: (teamId: number, node: DocNode) => void;

  isExpanded: (teamId: number, path: string) => boolean;
  toggleExpanded: (teamId: number, path: string) => void;
  setExpanded: (teamId: number, path: string, open: boolean) => void;

  scrollTop: number;
  setScrollTop: (n: number) => void;
}

const WorkspaceContext = createContext<WorkspaceState | null>(null);

export function WorkspaceProvider() {
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [teamsError, setTeamsError] = useState<string | null>(null);
  const [teamsLoading, setTeamsLoading] = useState(true);

  const [teamId, setTeamIdState] = useState<number | null>(() => {
    const saved = localStorage.getItem(TEAM_KEY);
    return saved ? Number(saved) : null;
  });

  // Caches / view state kept in refs so updating them never re-renders the
  // provider (which would remount the whole authed tree). Pages read them on
  // mount and drive their own local state.
  const treeCache = useRef(new Map<number, DocNode>());
  const expanded = useRef(new Set<string>());
  const scrollRef = useRef(0);
  // A version bump lets a consumer force a re-read when it wants to.
  const [, bump] = useState(0);

  const setTeamId = useCallback((id: number | null) => {
    setTeamIdState(id);
    if (id == null) localStorage.removeItem(TEAM_KEY);
    else localStorage.setItem(TEAM_KEY, String(id));
    scrollRef.current = 0;
  }, []);

  const reloadTeams = useCallback(async () => {
    setTeamsLoading(true);
    setTeamsError(null);
    try {
      const res = await mtCall(teamApi().listTeams({ pageSize: 100 }));
      setTeams(res.teams);
      return res.teams;
    } catch (err) {
      setTeamsError(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      setTeamsLoading(false);
    }
  }, []);

  useEffect(() => {
    reloadTeams().catch(() => {});
  }, [reloadTeams]);

  // Once teams are known, make sure the selected team is valid; default to first.
  useEffect(() => {
    if (!teams) return;
    if (teams.length === 0) {
      if (teamId !== null) setTeamId(null);
      return;
    }
    if (teamId == null || !teams.some((t) => t.id === teamId)) {
      setTeamId(teams[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teams]);

  const value: WorkspaceState = {
    teams,
    teamsError,
    teamsLoading,
    reloadTeams,
    teamId,
    setTeamId,
    treeFor: (id) => treeCache.current.get(id),
    setTree: (id, node) => {
      treeCache.current.set(id, node);
    },
    isExpanded: (id, path) => expanded.current.has(`${id}:${path}`),
    toggleExpanded: (id, path) => {
      const key = `${id}:${path}`;
      if (expanded.current.has(key)) expanded.current.delete(key);
      else expanded.current.add(key);
      bump((n) => n + 1);
    },
    setExpanded: (id, path, open) => {
      const key = `${id}:${path}`;
      if (open) expanded.current.add(key);
      else expanded.current.delete(key);
      bump((n) => n + 1);
    },
    scrollTop: scrollRef.current,
    setScrollTop: (n) => {
      scrollRef.current = n;
    },
  };

  return (
    <WorkspaceContext value={value}>
      <Outlet />
    </WorkspaceContext>
  );
}

export function useWorkspace(): WorkspaceState {
  const ctx = use(WorkspaceContext);
  if (!ctx)
    throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}
