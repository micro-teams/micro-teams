/*
 *  Description: Who can access which team — the single question every rule of the team model
 *               reduces to.
 *
 *               A user can access a team when they are a member of it, or of any team that
 *               contains it, at any depth (TeamSubteam). Everything in a team is then theirs to
 *               use: its documents, machines, chats and agents. There are no roles.
 *
 *               TeamAccess (a Spring bean):
 *                 memberTeamIds(userId) -> the teams the user is a member of.
 *                 accessibleTeamIds(userId) -> those and everything inside them.
 *                 mayAccess(userId, teamId) -> Boolean.
 *                 within(teamId) -> the team and every team inside it (used to refuse cycles).
 *
 *               Example: if team 2 is inside team 1 and Ann is a member of 1,
 *                 access.mayAccess(ann, 2) == true and access.memberTeamIds(ann) == setOf(1).
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.team.membership

import org.rucca.cheese.common.persistent.IdType
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

@Service
@Transactional(readOnly = true)
class TeamAccess(
    private val members: TeamMemberRepository,
    private val subteams: TeamSubteamRepository,
) {
    fun memberTeamIds(userId: IdType): Set<IdType> =
        members.findByUserId(userId).mapNotNull { it.teamId }.toSet()

    fun accessibleTeamIds(userId: IdType): Set<IdType> = closure(memberTeamIds(userId))

    fun mayAccess(userId: IdType, teamId: IdType): Boolean = teamId in accessibleTeamIds(userId)

    fun within(teamId: IdType): Set<IdType> = closure(setOf(teamId))

    private fun closure(roots: Set<IdType>): Set<IdType> {
        val seen = roots.toMutableSet()
        var frontier = roots
        while (frontier.isNotEmpty()) {
            frontier =
                subteams
                    .findByParentIdIn(frontier)
                    .mapNotNull { it.childId }
                    .filter { seen.add(it) }
                    .toSet()
        }
        return seen
    }
}
