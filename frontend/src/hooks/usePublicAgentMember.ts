import { useEffect } from "react";
import type { ChatMember } from "@/api";
import { useAgentPresence } from "@/hooks/useAgentPresence";

/**
 * A "public agent" chat is one whose members are exactly ONE agent plus humans
 * (any number, including zero). For such a chat the list shows the agent's avatar
 * as the group avatar. Returns that agent member, or null (0 agents, or 2+ agents —
 * then the chat renders as a normal group).
 *
 * Who is an agent comes from the member itself when the server was asked
 * (`queryIsMemberAgent`), which is the point: it arrives WITH the chat list, so the
 * first paint is already right. Deriving it from the app-global presence enumeration
 * instead made the row flash — presence loads asynchronously, so until it landed no
 * member looked like an agent and the row rendered the generic member grid, then
 * corrected itself (T-040).
 *
 * Presence remains the fallback for a server that was not asked (or is older, and
 * answers null), so this works either way and neither side has to deploy first.
 */
export function usePublicAgentMember(members: ChatMember[]): ChatMember | null {
  const answered = members.some((m) => m.isAgent != null);
  const { track, untrack, data } = useAgentPresence();
  const ids = members.map((m) => m.userId);
  const idKey = ids.join(",");

  useEffect(() => {
    // Nothing to look up when the list already told us; the ring/status elsewhere
    // tracks what it needs on its own.
    if (answered) return;
    ids.forEach((id) => track(id));
    return () => ids.forEach((id) => untrack(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey, answered]);

  const agents = answered
    ? members.filter((m) => m.isAgent)
    : members.filter((m) => data[m.userId]);
  return agents.length === 1 ? agents[0] : null;
}
