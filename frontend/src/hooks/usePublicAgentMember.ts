import { useEffect } from "react";
import type { ChatMember } from "@/api";
import { useAgentPresence } from "@/hooks/useAgentPresence";

/**
 * A "public agent" chat is one whose members are exactly ONE agent plus humans
 * (any number, including zero). For such a chat the list shows the agent's avatar
 * as the group avatar. Returns that agent member, or null (0 agents, or 2+ agents —
 * then the chat renders as a normal group).
 *
 * Membership is derived from app-global agent presence (a member is an agent iff
 * it appears in the enumeration). We track every member's id here so detection
 * works even for members the row itself doesn't render.
 */
export function usePublicAgentMember(members: ChatMember[]): ChatMember | null {
  const { track, untrack, data } = useAgentPresence();
  const ids = members.map((m) => m.userId);
  const idKey = ids.join(",");

  useEffect(() => {
    ids.forEach((id) => track(id));
    return () => ids.forEach((id) => untrack(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey]);

  const agents = members.filter((m) => data[m.userId]);
  return agents.length === 1 ? agents[0] : null;
}
