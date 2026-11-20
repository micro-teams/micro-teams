/*
 *  Description: The chat messages on their way to an agent's program, persisted so that a server
 *               restart cannot lose them silently.
 *
 *               AgentWakeup holds what it still owes an agent in memory, and a restart forgets
 *               it; the program never learns of those messages and their senders would never
 *               learn they were lost. So each chat message gets a row here while it is
 *               outstanding, removed once its outcome is definite, and a server starting up marks
 *               every row it finds undelivered.
 *
 *               AgentPendingMessage              (messageId, agentUserId), one per message and agent.
 *               AgentPendingMessageRepository    deleteByMessageIdAndAgentUserId(m, a), findAll().
 *
 *               Example: repository.save(AgentPendingMessage().also { it.messageId = 41 ... })
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.agent

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Table
import jakarta.persistence.UniqueConstraint
import org.rucca.cheese.common.persistent.BaseEntity
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.transaction.annotation.Transactional

@Entity
@Table(
    name = "agent_pending_message",
    uniqueConstraints =
        [
            UniqueConstraint(
                name = "uq_agent_pending_message",
                columnNames = ["message_id", "agent_user_id"],
            ),
        ],
)
class AgentPendingMessage : BaseEntity() {
    @Column(name = "message_id", nullable = false) var messageId: Long? = null

    @Column(name = "agent_user_id", nullable = false) var agentUserId: Long? = null
}

interface AgentPendingMessageRepository : JpaRepository<AgentPendingMessage, Long> {
    @Transactional fun deleteByMessageIdAndAgentUserId(messageId: Long, agentUserId: Long)
}
