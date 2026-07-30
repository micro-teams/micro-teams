package app.microteams.chat.message

import jakarta.persistence.*
import java.time.LocalDateTime
import org.rucca.cheese.common.persistent.BaseEntity
import org.springframework.data.jpa.repository.JpaRepository

@Entity
@Table(
    name = "message",
    indexes = [Index(name = "idx_message_thread_created", columnList = "thread_id, created_at")],
    // What makes a retried send safe: the same (thread, sender, token) can exist only once, so two
    // attempts at ONE message cannot become two messages — not even if they race, in which case the
    // loser gets a constraint violation and reads the winner's row instead of inserting.
    uniqueConstraints =
        [
            UniqueConstraint(
                name = "uq_message_client_token",
                columnNames = ["thread_id", "sender_id", "client_token"],
            )
        ],
)
open class MessageEntity : BaseEntity() {
    @Column(name = "thread_id", nullable = false) open var threadId: Long? = null
    @Column(name = "sender_id", nullable = false) open var senderId: Long? = null
    @Column(name = "content", nullable = false, columnDefinition = "TEXT")
    open var content: String? = null
    @Column(name = "edited_at") open var editedAt: LocalDateTime? = null

    /**
     * The sender's own id for this message, when it supplied one. Null for a caller that never
     * retries (an agent's `say`, a script), and null rows do not collide in the unique constraint —
     * Postgres treats NULLs as distinct — so opting out costs nothing.
     */
    @Column(name = "client_token", length = 64) open var clientToken: String? = null
}

interface MessageRepository : JpaRepository<MessageEntity, Long> {
    /**
     * Newest-first (highest id first). listMessages pages from this so the default (no cursor) page
     * is the most RECENT messages — a chat opens on its latest, and the cursor then walks toward
     * older history. See MessageService.listMessages.
     */
    fun findByThreadIdAndDeletedAtIsNullOrderByIdDesc(threadId: Long): List<MessageEntity>

    /** The most recent (highest-id) live message in a thread — for the chat-list preview. */
    fun findTopByThreadIdAndDeletedAtIsNullOrderByIdDesc(threadId: Long): MessageEntity?

    /**
     * The message this sender already posted under [clientToken], if any. Deliberately NOT filtered
     * by deletedAt: a token that was used and then deleted must not be reusable to insert a second
     * row, or the unique constraint would reject the insert and the retry would fail instead of
     * being recognised.
     */
    fun findByThreadIdAndSenderIdAndClientToken(
        threadId: Long,
        senderId: Long,
        clientToken: String,
    ): MessageEntity?
}
