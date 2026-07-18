package app.microteams.chat.thread

import jakarta.persistence.*
import org.rucca.cheese.common.persistent.BaseEntity
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.transaction.annotation.Transactional

@Entity
@Table(
    name = "thread_member",
    uniqueConstraints = [UniqueConstraint(columnNames = ["thread_id", "user_id"])],
)
open class ThreadMemberEntity : BaseEntity() {
    @Column(name = "thread_id", nullable = false) open var threadId: Long? = null

    @Column(name = "user_id", nullable = false) open var userId: Long? = null

    @Enumerated(EnumType.STRING)
    @Column(name = "role", nullable = false)
    open var role: ThreadMemberRole = ThreadMemberRole.MEMBER
}

interface ThreadMemberRepository : JpaRepository<ThreadMemberEntity, Long> {
    fun findByThreadIdAndUserId(threadId: Long, userId: Long): ThreadMemberEntity?

    fun findByThreadId(threadId: Long): List<ThreadMemberEntity>

    fun findByUserId(userId: Long): List<ThreadMemberEntity>

    fun findByThreadIdAndRole(threadId: Long, role: ThreadMemberRole): ThreadMemberEntity?

    @Modifying @Transactional fun deleteByThreadIdAndUserId(threadId: Long, userId: Long)
}
