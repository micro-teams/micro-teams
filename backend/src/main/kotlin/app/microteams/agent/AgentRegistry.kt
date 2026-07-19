/*
 *  Description: Which agents exist right now, and the one place chat reaches them through. Each
 *               live agent is registered here and, as itself, subscribed to chat — so being told
 *               something is not a lookup the orchestrator performs but a callback chat makes.
 *
 *               In-memory: an agent is live only while the server that opened it is up. Surviving
 *               a restart means re-adopting the screens still running on their machines and
 *               re-registering them here — the AgentScreen rows exist for exactly that, and the
 *               re-adopt path is the 「再完善」 item that would fill this back in.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.agent

import app.microteams.agent.screen.ScreenAgent
import app.microteams.chat.ChatSubscriber
import app.microteams.chat.ChatSubscriptions
import java.util.concurrent.ConcurrentHashMap
import org.rucca.cheese.common.persistent.IdType
import org.springframework.stereotype.Component

@Component
class AgentRegistry(private val chatSubscriptions: ChatSubscriptions) {
    private val byUser = ConcurrentHashMap<IdType, Agent>()

    /**
     * Screen-backed agents by screen id. Only they have one — an agent is not required to, so this
     * index is a property of the implementation rather than of [Agent], and callers that resolve a
     * sid (the tool-door, 现场) are asking specifically about a ScreenAgent.
     */
    private val bySid = ConcurrentHashMap<String, ScreenAgent>()

    fun register(agent: Agent) {
        byUser[agent.userId] = agent
        if (agent is ScreenAgent) bySid[agent.sid] = agent
        chatSubscriptions.register(
            object : ChatSubscriber {
                override val userId = agent.userId

                override fun onMessage(
                    threadId: IdType,
                    senderId: IdType,
                    speaker: String,
                    content: String,
                ) {
                    agent.tell(threadId, speaker, content)
                }
            }
        )
    }

    fun unregister(userId: IdType) {
        (byUser.remove(userId) as? ScreenAgent)?.let { bySid.remove(it.sid) }
        chatSubscriptions.unregister(userId)
    }

    fun get(userId: IdType): Agent? = byUser[userId]

    fun bySid(sid: String): ScreenAgent? = bySid[sid]

    fun screenAgents(): List<ScreenAgent> = bySid.values.toList()

    fun all(): Collection<Agent> = byUser.values
}
