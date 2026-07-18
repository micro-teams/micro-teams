/*
 *  Description: This file implements the TeamService class.
 *               It is responsible for CRUD of teams and their memberships,
 *               and for initializing each team's git document repository.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.team.membership

import app.microteams.common.helper.PageHelper
import app.microteams.model.*
import app.microteams.team.documents.GitService
import java.time.LocalDateTime
import java.time.ZoneOffset
import org.rucca.cheese.common.error.NotFoundError
import org.rucca.cheese.common.persistent.IdType
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

fun Team.toTeamDTO() =
    TeamDTO(
        id = this.id!!,
        name = this.name!!,
        // Nullable: @CreationTimestamp only populates on flush, so a just-saved (not-yet-flushed)
        // Team has a null createdAt in memory. The DTO field is optional for exactly this reason.
        createdAt = this.createdAt?.atOffset(ZoneOffset.UTC),
        updatedAt = this.updatedAt?.atOffset(ZoneOffset.UTC),
    )

fun TeamMember.toTeamMemberDTO() =
    TeamMemberDTO(userId = this.userId!!, nickname = null, role = this.role!!.convert())

fun TeamMemberRole.convert(): TeamMemberDTO.Role =
    when (this) {
        TeamMemberRole.OWNER -> TeamMemberDTO.Role.OWNER
        TeamMemberRole.ADMIN -> TeamMemberDTO.Role.ADMIN
        TeamMemberRole.MEMBER -> TeamMemberDTO.Role.MEMBER
    }

fun AddTeamMemberRequestDTO.Role.convert(): TeamMemberRole =
    when (this) {
        AddTeamMemberRequestDTO.Role.OWNER -> TeamMemberRole.OWNER
        AddTeamMemberRequestDTO.Role.ADMIN -> TeamMemberRole.ADMIN
        AddTeamMemberRequestDTO.Role.MEMBER -> TeamMemberRole.MEMBER
    }

fun ChangeRoleRequestDTO.Role.convert(): TeamMemberRole =
    when (this) {
        ChangeRoleRequestDTO.Role.OWNER -> TeamMemberRole.OWNER
        ChangeRoleRequestDTO.Role.ADMIN -> TeamMemberRole.ADMIN
        ChangeRoleRequestDTO.Role.MEMBER -> TeamMemberRole.MEMBER
    }

@Service
@Transactional
class TeamService(
    private val teamRepository: TeamRepository,
    private val teamMemberRepository: TeamMemberRepository,
    private val gitService: GitService,
) {
    fun getTeam(teamId: IdType): Team =
        teamRepository.findById(teamId).orElseThrow { NotFoundError("team", teamId) }

    fun getTeamDTO(teamId: IdType): TeamDTO = getTeam(teamId).toTeamDTO()

    fun getTeamDetail(teamId: IdType): TeamDetailDTO =
        TeamDetailDTO(team = getTeam(teamId).toTeamDTO(), members = listMembers(teamId))

    fun createTeam(name: String, ownerId: IdType): TeamDTO {
        val team = teamRepository.save(Team(name = name))
        teamMemberRepository.save(
            TeamMember(teamId = team.id!!, userId = ownerId, role = TeamMemberRole.OWNER)
        )
        gitService.initBareRepo(team.id!!)
        return team.toTeamDTO()
    }

    fun listMyTeams(
        userId: IdType,
        role: TeamMemberRole?,
        pageStart: IdType?,
        pageSize: Int,
    ): Pair<List<TeamDTO>, PageDTO> {
        val memberships =
            teamMemberRepository.findByUserId(userId).let { rows ->
                if (role != null) rows.filter { it.role == role } else rows
            }
        val teamIds = memberships.mapNotNull { it.teamId }.toSet()
        val teams = teamRepository.findAllById(teamIds).sortedBy { it.id }
        val (page, pageInfo) = PageHelper.pageFromAll(teams, pageStart, pageSize, { it.id!! }, null)
        return page.map { it.toTeamDTO() } to pageInfo
    }

    fun renameTeam(teamId: IdType, name: String): TeamDTO {
        val team = getTeam(teamId)
        team.name = name
        return teamRepository.save(team).toTeamDTO()
    }

    fun deleteTeam(teamId: IdType) {
        val team = getTeam(teamId)
        team.deletedAt = LocalDateTime.now()
        teamRepository.save(team)
    }

    fun listMembers(teamId: IdType): List<TeamMemberDTO> =
        teamMemberRepository.findByTeamId(teamId).map { it.toTeamMemberDTO() }

    fun addMember(teamId: IdType, userId: IdType, role: TeamMemberRole) {
        val existing = teamMemberRepository.findByTeamIdAndUserId(teamId, userId).orElse(null)
        if (existing != null) {
            existing.role = role
            teamMemberRepository.save(existing)
        } else {
            teamMemberRepository.save(TeamMember(teamId = teamId, userId = userId, role = role))
        }
    }

    fun changeRole(teamId: IdType, userId: IdType, role: TeamMemberRole) {
        val member =
            teamMemberRepository.findByTeamIdAndUserId(teamId, userId).orElseThrow {
                NotFoundError("team_member", userId)
            }
        member.role = role
        teamMemberRepository.save(member)
    }

    // Memberships are hard-deleted (like chat's ThreadMember); no soft-delete
    // reactivation dance and thus no @SQLRestriction on TeamMember. deleteBy is idempotent.
    fun removeMember(teamId: IdType, userId: IdType) {
        teamMemberRepository.deleteByTeamIdAndUserId(teamId, userId)
    }

    // -- authorization helpers (wired into custom logics by TeamController) --

    fun getTeamOwner(teamId: IdType): IdType =
        teamMemberRepository
            .findByTeamIdAndRole(teamId, TeamMemberRole.OWNER)
            .orElseThrow { NotFoundError("team", teamId) }
            .userId!!

    fun isTeamMember(teamId: IdType, userId: IdType): Boolean =
        teamMemberRepository.findByTeamIdAndUserId(teamId, userId).isPresent

    fun isTeamAdmin(teamId: IdType, userId: IdType): Boolean =
        teamMemberRepository
            .findByTeamIdAndUserId(teamId, userId)
            .map { it.role == TeamMemberRole.ADMIN || it.role == TeamMemberRole.OWNER }
            .orElse(false)
}
