/*
 *  Description: Who owns which machine — the business half of the machine story, which is why it
 *               lives under team rather than under machine. The machine module knows how to talk
 *               to a machine; this knows whose it is, and therefore who may use it.
 *
 *               A machine may be in many teams, and everyone who can access any of them (TeamAccess:
 *               members, and members of teams containing them) has full, equal rights over it. That
 *               makes [mayAccess] the single access question the rest of the backend asks about a
 *               machine — its terminals, opening an agent on it, the live screen all resolve to it.
 *
 *               Two invariants hold here, whoever acts: a machine stays in at least one team, and a
 *               team keeps the machine of every agent that is a member of it.
 *
 *               teamsOf(machineId) / machineIdsOf(teamId) / servesTeam(machineId, teamId)
 *               mayAccess(userId, machineId)
 *               bind(machineId, teamId) / unbind(machineId, teamId) — unbind refuses to break an
 *                 invariant (BadRequestError, saying what to do instead).
 *               unbindAll(machineId) — when the machine itself is forgotten.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.team.machine

import app.microteams.team.membership.TeamAccess
import app.microteams.team.membership.TeamMemberRepository
import app.microteams.user.AgentUsers
import org.rucca.cheese.common.error.BadRequestError
import org.rucca.cheese.common.persistent.IdType
import org.springframework.beans.factory.ObjectProvider
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

@Service
@Transactional
class TeamMachineService(
    private val teamMachineRepository: TeamMachineRepository,
    private val teamMemberRepository: TeamMemberRepository,
    private val access: TeamAccess,
    private val agentUsers: ObjectProvider<AgentUsers>,
) {
    /** The teams a machine is in. */
    fun teamsOf(machineId: String): List<IdType> =
        teamMachineRepository.findByMachineId(machineId).mapNotNull { it.teamId }

    /** The machines in a team. */
    fun machineIdsOf(teamId: IdType): List<String> =
        teamMachineRepository.findByTeamId(teamId).mapNotNull { it.machineId }

    fun servesTeam(machineId: String, teamId: IdType): Boolean =
        teamMachineRepository.existsByMachineIdAndTeamId(machineId, teamId)

    /** Whether [userId] may use this machine: whether they can access any team it is in. */
    fun mayAccess(userId: IdType, machineId: String): Boolean {
        val mine = access.accessibleTeamIds(userId)
        return teamsOf(machineId).any { it in mine }
    }

    fun bind(machineId: String, teamId: IdType) {
        if (!teamMachineRepository.existsByMachineIdAndTeamId(machineId, teamId)) {
            teamMachineRepository.save(TeamMachine(machineId = machineId, teamId = teamId))
        }
    }

    fun unbind(machineId: String, teamId: IdType) {
        if (!servesTeam(machineId, teamId)) return
        if (teamsOf(machineId).size == 1) {
            throw BadRequestError(
                "this is the only team machine $machineId is in; forget the machine instead",
            )
        }
        val members = teamMemberRepository.findByTeamId(teamId).mapNotNull { it.userId }
        val running =
            agentUsers.ifAvailable
                ?.machinesOf(members)
                ?.filterValues { it == machineId }
                ?.keys
                .orEmpty()
        if (running.isNotEmpty()) {
            throw BadRequestError(
                "agent ${running.joinToString()} of this team runs on machine $machineId; remove it from the team first",
            )
        }
        teamMachineRepository.deleteByMachineIdAndTeamId(machineId, teamId)
    }

    fun unbindAll(machineId: String) = teamMachineRepository.deleteByMachineId(machineId)
}
