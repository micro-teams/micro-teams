// Small agent-flow helpers shared by the phone and desktop agent surfaces. The
// generated AgentApi/ChatApi still do the talking; this only holds the one bit of
// glue both shells need: turning an agent into a conversation you can talk to.

import type { Agent } from "@/api";
import { chatApi, mtCall } from "@/lib/mtApi";

/**
 * Start a conversation with an agent: reuse the existing 1:1 with it if there is
 * one, otherwise create a thread that includes it (the caller is added as owner by
 * the backend). Returns the thread id to navigate to. Reusing the existing 1:1 is
 * what stops repeated "chat with agent" clicks from piling up duplicate DMs.
 *
 * "The 1:1 with this agent" is a chat the caller is in whose only two members are
 * the caller and this agent — listChats returns only the caller's chats, so a
 * two-member chat containing the agent can only be that pair.
 */
export async function startChatWithAgent(
  agent: Pick<Agent, "userId" | "nickname">,
): Promise<number> {
  const { chats } = await mtCall(chatApi().listChats({ pageSize: 100 }));
  const existing = chats.find(
    (c) =>
      c.members.length === 2 &&
      c.members.some((m) => m.userId === agent.userId),
  );
  if (existing) return existing.id;

  const thread = await mtCall(
    chatApi().createThread({
      createThreadRequest: {
        title: agent.nickname || `agent #${agent.userId}`,
        memberIds: [agent.userId],
      },
    }),
  );
  return thread.id;
}
