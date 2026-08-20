// App-global agent presence. Every shared avatar (UserAvatar) tracks its user id here; the
// provider batches all tracked ids into one request, so any avatar anywhere becomes agent-aware
// (ring + status + live live-screen sid) from a single shared fetch.
//
// That fetch is just `GET /agent?userId=...` — the one agent enumeration, filtered. Only agents
// come back, so "is this user an agent?" is simply whether the id is present in `data`, and the
// server attaches `sid` only for an agent this viewer is allowed to watch.
//
// It used to run on two timers: a 4s tick for liveness and a 300ms tick to catch newly-tracked ids
// quickly. Both are gone. Liveness now arrives on the team topic (an agent dying or coming back is
// something the server knows the instant it happens), and a newly-tracked id is an effect of the
// tracked set changing rather than something to poll for — which is also strictly more responsive
// than 300ms, because it fires on the change itself.

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
import { useUpdatesTopic } from "@/hooks/useUpdates";
import { useWorkspace } from "@/hooks/useWorkspace";
import { teamTopic } from "@/lib/updates/topics";

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
  // Bumped whenever the set of tracked ids actually changes, which is what asks for a fetch. A
  // counter rather than the set itself: avatars mount and unmount constantly, and only a change in
  // WHICH ids are tracked is worth a request.
  const [trackedGeneration, setTrackedGeneration] = useState(0);
  const ws = useWorkspace();

  const track = useCallback((userId: number) => {
    if (!userId) return;
    const had = counts.current.has(userId);
    counts.current.set(userId, (counts.current.get(userId) ?? 0) + 1);
    if (!had) setTrackedGeneration((g) => g + 1);
  }, []);

  const untrack = useCallback((userId: number) => {
    if (!userId) return;
    const n = (counts.current.get(userId) ?? 0) - 1;
    if (n <= 0) counts.current.delete(userId);
    else counts.current.set(userId, n);
  }, []);

  const inFlight = useRef(false);
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    const ids = Array.from(counts.current.keys());
    if (ids.length === 0) return;
    inFlight.current = true;
    try {
      const { agents } = await mtCall(agentApi().listAgents({ userId: ids }));
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
      inFlight.current = false;
    }
  }, []);

  // Newly tracked ids: fetch on the change itself rather than on a tick that hunts for it.
  useEffect(() => {
    void refresh();
  }, [refresh, trackedGeneration]);

  // Liveness: an agent dying, being revived or being closed is something the server knows at once.
  // No digest here — presence is a slice of the team answer taken over whichever ids happen to be
  // on screen, so there is nothing stable for the periodic check to compare against; the team topic
  // carries its own digest and this rides the same events.
  useUpdatesTopic(ws.teamId != null ? teamTopic(ws.teamId) : null, () => {
    void refresh();
  });

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
