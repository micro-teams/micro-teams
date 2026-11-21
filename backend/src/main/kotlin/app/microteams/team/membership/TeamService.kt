/*
 *  Description: Teams, their members and the teams inside them, and each team's git document
 *               repository.
 *
 *               Members have no roles. The rules about who may do what live in the authorization
 *               table; this service keeps the model's invariants, which hold whoever acts:
 *                 - an agent in a team has its machine in that team (adding the agent adds it);
 *                 - containment has no cycle (nesting a team inside one of its own descendants is
 *                   refused);
 *                 - a machine is in at least one team (deleting the last team a machine is in is
 *                   refused; forgetting the machine is how it goes).
 *
 *               getTeam(id) / getTeamDTO(id) / getTeamDetail(id, callerId)
 *               createTeam(name, creatorId, parentId?) -> TeamDTO — the creator is its first member.
 *               listMyTeams(userId, pageStart, pageSize) — the teams the user is a member of.
 *               renameTeam(id, name) / deleteTeam(id)
 *               listMembers(id) -> members with their names, avatars and whether they are agents.
 *               addMember(id, userId) / removeMember(id, userId)
 *               addSubteam(parentId, childId) / removeSubteam(parentId, childId)
 *               isTeamMember(teamId, userId)
 *
 *               Example: val t = teamService.createTeam("Research", ann, parentId = lab.id)
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.team.membership

import app.microteams.common.helper.PageHelper
import app.microteams.model.PageDTO
import app.microteams.model.TeamDTO
import app.microteams.model.TeamDetailDTO
import app.microteams.model.TeamMemberDTO
import app.microteams.team.chat.TeamChatRepository
import app.microteams.team.documents.GitService
import app.microteams.team.machine.TeamMachine
import app.microteams.team.machine.TeamMachineRepository
import app.microteams.user.AgentUsers
import app.microteams.user.UserProfileRepository
import java.time.LocalDateTime
import java.time.ZoneOffset
import org.rucca.cheese.common.error.BadRequestError
import org.rucca.cheese.common.error.NotFoundError
import org.rucca.cheese.common.persistent.IdType
import org.springframework.beans.factory.ObjectProvider
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

@Service
@Transactional
class TeamService(
    private val teamRepository: TeamRepository,
    private val teamMemberRepository: TeamMemberRepository,
    private val subteamRepository: TeamSubteamRepository,
    private val teamMachineRepository: TeamMachineRepository,
    private val teamChatRepository: TeamChatRepository,
    private val userProfileRepository: UserProfileRepository,
    private val access: TeamAccess,
    private val gitService: GitService,
    // Optional for the same reason as chat's: the agent module answers it, and the team module
    // must not import the agent module.
    private val agentUsers: ObjectProvider<AgentUsers>,
) {
    fun getTeam(teamId: IdType): Team =
        teamRepository.findById(teamId).orElseThrow { NotFoundError("team", teamId) }

    fun getTeamDTO(teamId: IdType): TeamDTO = getTeam(teamId).toTeamDTO()

    /** Teams that exist, in id order: an edge to a deleted team is not shown. */
    fun teamsByIds(ids: Collection<IdType>): List<TeamDTO> =
        teamRepository.findAllById(ids.toSet()).sortedBy { it.id }.map { it.toTeamDTO() }

    fun getTeamDetail(teamId: IdType, callerId: IdType): TeamDetailDTO =
        TeamDetailDTO(
            team = getTeam(teamId).toTeamDTO(),
            members = listMembers(teamId),
            parents =
                teamsByIds(subteamRepository.findByChildId(teamId).mapNotNull { it.parentId }),
            subteams =
                teamsByIds(subteamRepository.findByParentId(teamId).mapNotNull { it.childId }),
            isMember = isTeamMember(teamId, callerId),
        )

    fun createTeam(name: String, creatorId: IdType, parentId: IdType?): TeamDTO {
        if (parentId != null) getTeam(parentId)
        val team = teamRepository.save(Team(name = name))
        teamMemberRepository.save(TeamMember(teamId = team.id!!, userId = creatorId))
        if (parentId != null)
            subteamRepository.save(TeamSubteam(parentId = parentId, childId = team.id!!))
        gitService.initBareRepo(team.id!!)
        return team.toTeamDTO()
    }

    fun listMyTeams(
        userId: IdType,
        pageStart: IdType?,
        pageSize: Int,
    ): Pair<List<TeamDTO>, PageDTO> {
        val teams = teamRepository.findAllById(access.memberTeamIds(userId)).sortedBy { it.id }
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
        val stranded =
            teamMachineRepository
                .findByTeamId(teamId)
                .mapNotNull { it.machineId }
                .filter { m ->
                    teamMachineRepository.findByMachineId(m).all { it.teamId == teamId }
                }
        if (stranded.isNotEmpty()) {
            throw BadRequestError(
                "machine ${stranded.joinToString()} is in no other team; put it in another team or forget it first",
            )
        }
        team.deletedAt = LocalDateTime.now()
        teamRepository.save(team)
        teamMemberRepository.findByTeamId(teamId).forEach { teamMemberRepository.delete(it) }
        subteamRepository.deleteByParentId(teamId)
        subteamRepository.deleteByChildId(teamId)
        teamMachineRepository.findByTeamId(teamId).forEach { teamMachineRepository.delete(it) }
        teamChatRepository.deleteByTeamId(teamId)
    }

    fun listMembers(teamId: IdType): List<TeamMemberDTO> {
        val ids = teamMemberRepository.findByTeamId(teamId).mapNotNull { it.userId }.sorted()
        val agents = agentUsers.ifAvailable?.agentsAmong(ids) ?: emptySet()
        return ids.map { id ->
            val profile = userProfileRepository.findByUserId(id.toInt()).orElse(null)
            TeamMemberDTO(
                userId = id,
                nickname = profile?.nickname ?: "user$id",
                avatarId = profile?.avatar?.id?.toLong(),
                isAgent = id in agents,
            )
        }
    }

    fun addMember(teamId: IdType, userId: IdType) {
        getTeam(teamId)
        if (!isTeamMember(teamId, userId))
            teamMemberRepository.save(TeamMember(teamId = teamId, userId = userId))
        val machine = agentUsers.ifAvailable?.machinesOf(listOf(userId))?.get(userId) ?: return
        if (!teamMachineRepository.existsByMachineIdAndTeamId(machine, teamId)) {
            teamMachineRepository.save(TeamMachine(machineId = machine, teamId = teamId))
        }
    }

    // Memberships are hard-deleted (like chat's ThreadMember); deleteBy is idempotent.
    fun removeMember(teamId: IdType, userId: IdType) {
        teamMemberRepository.deleteByTeamIdAndUserId(teamId, userId)
    }

    fun addSubteam(parentId: IdType, childId: IdType) {
        getTeam(parentId)
        getTeam(childId)
        if (parentId in access.within(childId)) {
            throw BadRequestError(
                "team $parentId is inside team $childId already; nesting it would make a cycle",
            )
        }
        if (!subteamRepository.existsByParentIdAndChildId(parentId, childId)) {
            subteamRepository.save(TeamSubteam(parentId = parentId, childId = childId))
        }
    }

    fun removeSubteam(parentId: IdType, childId: IdType) {
        subteamRepository.deleteByParentIdAndChildId(parentId, childId)
    }

    fun isTeamMember(teamId: IdType, userId: IdType): Boolean =
        teamMemberRepository.findByTeamIdAndUserId(teamId, userId).isPresent
}
