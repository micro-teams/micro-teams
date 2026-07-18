package app.microteams.chat.message

import jakarta.persistence.*
import java.time.LocalDateTime
import org.rucca.cheese.common.persistent.BaseEntity
import org.springframework.data.jpa.repository.JpaRepository

@Entity
@Table(
    name = "message",
    indexes = [Index(name = "idx_message_thread_created", columnList = "thread_id, created_at")],
)
open class MessageEntity : BaseEntity() {
    @Column(name = "thread_id", nullable = false) open var threadId: Long? = null
    @Column(name = "sender_id", nullable = false) open var senderId: Long? = null
    @Column(name = "content", nullable = false, columnDefinition = "TEXT")
    open var content: String? = null
    @Column(name = "edited_at") open var editedAt: LocalDateTime? = null
}

interface MessageRepository : JpaRepository<MessageEntity, Long> {
    fun findByThreadIdAndDeletedAtIsNullOrderById(threadId: Long): List<MessageEntity>

    /** The most recent (highest-id) live message in a thread — for the chat-list preview. */
    fun findTopByThreadIdAndDeletedAtIsNullOrderByIdDesc(threadId: Long): MessageEntity?
}
