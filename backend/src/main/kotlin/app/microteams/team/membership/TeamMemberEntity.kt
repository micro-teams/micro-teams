/*
 *  Description: This file defines the TeamMember entity, the membership role
 *               enum, and their repository. It stores a user's membership of a team.
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

enum class TeamMemberRole {
    OWNER,
    ADMIN,
    MEMBER,
}

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
    @Enumerated(EnumType.STRING) @Column(nullable = false) var role: TeamMemberRole? = null,
) : BaseEntity()

interface TeamMemberRepository : JpaRepository<TeamMember, IdType> {
    fun findByTeamId(teamId: IdType): List<TeamMember>

    fun findByUserId(userId: IdType): List<TeamMember>

    fun findByTeamIdAndUserId(teamId: IdType, userId: IdType): Optional<TeamMember>

    fun findByTeamIdAndRole(teamId: IdType, role: TeamMemberRole): Optional<TeamMember>

    fun deleteByTeamIdAndUserId(teamId: IdType, userId: IdType)
}
