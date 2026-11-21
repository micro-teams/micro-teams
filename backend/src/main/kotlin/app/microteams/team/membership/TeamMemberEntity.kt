/*
 *  Description: This file defines the TeamMember entity and its repository: one user's
 *               membership of one team. Members have no roles: everyone who can access a team
 *               can do everything in it (see TeamAccess).
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.team.membership

import jakarta.persistence.*
import java.util.Optional
import org.rucca.cheese.common.persistent.BaseEntity
import org.rucca.cheese.common.persistent.IdType
import org.springframework.data.jpa.repository.JpaRepository

// No @SQLRestriction: memberships are hard-deleted (see TeamService.removeMember), so there
// are never soft-deleted rows to filter. Soft delete would also silently break the
// "member already exists" check in addMember.
@Entity
@Table(
    name = "team_member",
    indexes = [Index(columnList = "team_id"), Index(columnList = "user_id")],
)
class TeamMember(
    @Column(name = "team_id", nullable = false) var teamId: IdType? = null,
    @Column(name = "user_id", nullable = false) var userId: IdType? = null,
) : BaseEntity()

interface TeamMemberRepository : JpaRepository<TeamMember, IdType> {
    fun findByTeamId(teamId: IdType): List<TeamMember>

    fun findByUserId(userId: IdType): List<TeamMember>

    fun findByTeamIdAndUserId(teamId: IdType, userId: IdType): Optional<TeamMember>

    fun deleteByTeamIdAndUserId(teamId: IdType, userId: IdType)
}
