// App-global agent presence. Every shared avatar (UserAvatar) tracks its user id here; the
// provider batches all tracked ids into one poll, so any avatar anywhere becomes agent-aware
// (ring + status + live 现场 sid) from a single shared request.
//
// That poll is just `GET /agent?userId=...` — the one agent enumeration, filtered. Only agents
// come back, so "is this user an agent?" is simply whether the id is present in `data`, and the
// server attaches `sid` only for an agent this viewer is allowed to watch.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Agent } from "@/api";
import { agentApi, mtCall } from "@/lib/mtApi";

interface PresenceContextValue {
  track: (userId: number) => void;
  untrack: (userId: number) => void;
  /** Keyed by user id. A missing id means "not an agent" (or not visible to us). */
  data: Record<number, Agent>;
}

const PresenceContext = createContext<PresenceContextValue | null>(null);

export function AgentPresenceProvider({ children }: { children: ReactNode }) {
  const counts = useRef<Map<number, number>>(new Map());
  const [data, setData] = useState<Record<number, Agent>>({});
  const dirty = useRef(false);

  const track = useCallback((userId: number) => {
    if (!userId) return;
    counts.current.set(userId, (counts.current.get(userId) ?? 0) + 1);
    dirty.current = true;
  }, []);

  const untrack = useCallback((userId: number) => {
    if (!userId) return;
    const n = (counts.current.get(userId) ?? 0) - 1;
    if (n <= 0) counts.current.delete(userId);
    else counts.current.set(userId, n);
  }, []);

  useEffect(() => {
    let active = true;
    let inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      const ids = Array.from(counts.current.keys());
      if (ids.length === 0) {
        dirty.current = false;
        return;
      }
      inFlight = true;
      dirty.current = false;
      try {
        const { agents } = await mtCall(agentApi().listAgents({ userId: ids }));
        if (!active) return;
        setData((prev) => {
          const next = { ...prev };
          // Drop ids that came back empty: an agent that was closed must stop looking live.
          for (const id of ids) delete next[id];
          for (const a of agents) next[a.userId] = a;
          return next;
        });
      } catch {
        /* keep last-known presence on a transient failure */
      } finally {
        inFlight = false;
      }
    };
    // A steady poll for liveness, plus a fast tick that fires right after new ids appear.
    const slow = setInterval(poll, 4000);
    const fast = setInterval(() => {
      if (dirty.current) void poll();
    }, 300);
    void poll();
    return () => {
      active = false;
      clearInterval(slow);
      clearInterval(fast);
    };
  }, []);

  return (
    <PresenceContext.Provider value={{ track, untrack, data }}>
      {children}
    </PresenceContext.Provider>
  );
}

export function useAgentPresence(): PresenceContextValue {
  const ctx = useContext(PresenceContext);
  if (!ctx)
    throw new Error(
      "useAgentPresence must be used within AgentPresenceProvider",
    );
  return ctx;
}
