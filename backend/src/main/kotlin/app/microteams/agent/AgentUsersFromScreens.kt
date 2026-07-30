/*
 *  Description: The agent module's answer to `AgentUsers`: a user is an agent exactly when it has
 *               an AgentScreen row. That is the same definition the rest of this module uses —
 *               "being an agent" is derived from having a screen, never from a flag on the user —
 *               and reading it from the row rather than the in-memory registry matters: a server
 *               that has not re-adopted a screen yet still knows that user is an agent, so a chat
 *               list rendered right after a restart does not briefly claim otherwise.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.agent

import app.microteams.agent.screen.AgentScreenRepository
import app.microteams.user.AgentUsers
import org.rucca.cheese.common.persistent.IdType
import org.springframework.stereotype.Component

@Component
class AgentUsersFromScreens(private val agentScreenRepository: AgentScreenRepository) : AgentUsers {
    override fun agentsAmong(userIds: Collection<IdType>): Set<IdType> {
        if (userIds.isEmpty()) return emptySet()
        return agentScreenRepository
            .findByAgentUserIdIn(userIds.distinct())
            .map { it.agentUserId }
            .toSet()
    }
}
