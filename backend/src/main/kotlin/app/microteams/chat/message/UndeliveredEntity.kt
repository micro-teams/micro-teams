/*
 *  Description: A message that could not be delivered to one of its recipients, and why.
 *
 *               Chat delivers a message to software members (agents) by calling them back
 *               (ChatSubscriptions), and only they learn whether it reached the program behind
 *               them. When it definitely did not, the sender has to see that under the message,
 *               so the outcome is written back here — a chat-owned record that the subscriber's
 *               module writes through MessageService.markUndelivered, keeping chat free of any
 *               knowledge of agents.
 *
 *               Undelivered            (messageId, userId, reason) — one per message and recipient.
 *               UndeliveredRepository  findByMessageIdIn(ids), existsByMessageIdAndUserId(m, u).
 *
 *               Example: undeliveredRepository.findByMessageIdIn(listOf(41L, 42L))
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.chat.message

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Index
import jakarta.persistence.Table
import jakarta.persistence.UniqueConstraint
import org.rucca.cheese.common.persistent.BaseEntity
import org.springframework.data.jpa.repository.JpaRepository

@Entity
@Table(
    name = "message_undelivered",
    indexes = [Index(name = "idx_message_undelivered_message", columnList = "message_id")],
    uniqueConstraints =
        [
            UniqueConstraint(
                name = "uq_message_undelivered",
                columnNames = ["message_id", "user_id"],
            ),
        ],
)
class Undelivered : BaseEntity() {
    @Column(name = "message_id", nullable = false) var messageId: Long? = null

    /** The recipient it did not reach. */
    @Column(name = "user_id", nullable = false) var userId: Long? = null

    @Column(name = "reason", nullable = false, columnDefinition = "TEXT") var reason: String? = null
}

interface UndeliveredRepository : JpaRepository<Undelivered, Long> {
    fun findByMessageIdIn(messageIds: Collection<Long>): List<Undelivered>

    fun existsByMessageIdAndUserId(messageId: Long, userId: Long): Boolean
}
