/*
 *  Description: Which chats are in which teams: one row says that thread [threadId] is in team
 *               [teamId]. Whoever can access the team can read the thread and join it. The chat
 *               module knows nothing of this (chat depends on nothing); the team module owns the
 *               link, as team/machine owns a machine's.
 *
 *               TeamChat / TeamChatRepository — the row and its repository.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.team.chat

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Index
import jakarta.persistence.Table
import jakarta.persistence.UniqueConstraint
import org.rucca.cheese.common.persistent.BaseEntity
import org.rucca.cheese.common.persistent.IdType
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.transaction.annotation.Transactional

// Hard-deleted: a thread is in a team or it is not.
@Entity
@Table(
    name = "team_chat",
    uniqueConstraints = [UniqueConstraint(columnNames = ["team_id", "thread_id"])],
    indexes = [Index(columnList = "team_id"), Index(columnList = "thread_id")],
)
class TeamChat(
    @Column(name = "team_id", nullable = false) var teamId: IdType? = null,
    @Column(name = "thread_id", nullable = false) var threadId: IdType? = null,
) : BaseEntity()

interface TeamChatRepository : JpaRepository<TeamChat, IdType> {
    fun findByTeamId(teamId: IdType): List<TeamChat>

    fun findByThreadId(threadId: IdType): List<TeamChat>

    fun existsByTeamIdAndThreadId(teamId: IdType, threadId: IdType): Boolean

    @Modifying @Transactional fun deleteByTeamIdAndThreadId(teamId: IdType, threadId: IdType)

    @Modifying @Transactional fun deleteByTeamId(teamId: IdType)
}
