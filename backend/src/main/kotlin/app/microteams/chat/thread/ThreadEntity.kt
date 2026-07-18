package app.microteams.chat.thread

import jakarta.persistence.*
import org.hibernate.annotations.SQLRestriction
import org.rucca.cheese.common.persistent.BaseEntity
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query

@Entity
@Table(name = "thread")
@SQLRestriction("deleted_at IS NULL")
open class ThreadEntity : BaseEntity() {
    @Column(name = "title") open var title: String? = null
}

interface ThreadRepository : JpaRepository<ThreadEntity, Long> {
    @Query(
        """
        SELECT DISTINCT t FROM ThreadEntity t
        JOIN ThreadMemberEntity m ON m.threadId = t.id
        WHERE m.userId = :userId
        ORDER BY t.updatedAt DESC
    """
    )
    fun threadsForUser(userId: Long): List<ThreadEntity>
}
