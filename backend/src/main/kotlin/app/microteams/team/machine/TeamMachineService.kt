/*
 *  Description: Who owns which machine — the business half of the machine story, which is why it
 *               lives under team rather than under machine. The machine module knows how to talk
 *               to a machine; this knows whose it is, and therefore who may use it.
 *
 *               The model is deliberately symmetric and owner-less: a machine may serve many
 *               teams, and every member of any of them has full, equal rights over it. That makes
 *               [mayAccess] the single access question the rest of the backend asks about a
 *               machine — enrollment, the control channel and 现场 all resolve to it.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.team.machine

import app.microteams.team.membership.TeamService
import org.rucca.cheese.common.persistent.IdType
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

@Service
@Transactional
class TeamMachineService(
    private val teamMachineRepository: TeamMachineRepository,
    private val teamService: TeamService,
) {
    /** The teams a machine serves. */
    fun teamsOf(machineId: String): List<IdType> =
        teamMachineRepository.findByMachineId(machineId).mapNotNull { it.teamId }

    /** The machines a team owns. */
    fun machineIdsOf(teamId: IdType): List<String> =
        teamMachineRepository.findByTeamId(teamId).mapNotNull { it.machineId }

    /** Whether the machine may host [teamId]'s work. */
    fun servesTeam(machineId: String, teamId: IdType): Boolean =
        teamMachineRepository.existsByMachineIdAndTeamId(machineId, teamId)

    /**
     * Whether [userId] may use this machine at all — a member of any team it serves. This is the
     * whole access model; everything about a machine (renaming it, opening an agent on it, watching
     * one of its screens) reduces to this question.
     */
    fun mayAccess(userId: IdType, machineId: String): Boolean =
        teamsOf(machineId).any { teamService.isTeamMember(it, userId) }

    fun bind(machineId: String, teamId: IdType) {
        if (!teamMachineRepository.existsByMachineIdAndTeamId(machineId, teamId)) {
            teamMachineRepository.save(TeamMachine(machineId = machineId, teamId = teamId))
        }
    }

    fun unbind(machineId: String, teamId: IdType) {
        teamMachineRepository.deleteByMachineIdAndTeamId(machineId, teamId)
    }

    /** Whether the machine is now orphaned — no team owns it, so nobody can reach it. */
    fun isOrphaned(machineId: String): Boolean =
        teamMachineRepository.findByMachineId(machineId).isEmpty()

    fun unbindAll(machineId: String) = teamMachineRepository.deleteByMachineId(machineId)
}
