/*
 *  Description: A team's chats: which threads are in which teams, and who can therefore read
 *               them. The thread itself belongs to the chat module; this service only places it.
 *
 *               It also answers the chat module's ThreadTeams question, so a thread's detail can
 *               show which teams it is in (anyone who can read a thing can see who it is exposed to).
 *
 *               TeamChatService (a Spring bean, also the ThreadTeams implementation):
 *                 threadIdsOf(teamId) / teamsOf(threadId)
 *                 place(teamId, threadId) / unplace(teamId, threadId)
 *                 mayRead(userId, threadId) — a member of the thread, or able to access one of its teams.
 *
 *               Example: chats.place(research.id, thread.id); chats.mayRead(ann, thread.id)
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.team.chat

import app.microteams.chat.thread.ThreadMemberRepository
import app.microteams.chat.thread.ThreadTeams
import app.microteams.model.TeamDTO
import app.microteams.team.membership.TeamAccess
import app.microteams.team.membership.TeamService
import org.rucca.cheese.common.persistent.IdType
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

@Service
@Transactional
class TeamChatService(
    private val teamChats: TeamChatRepository,
    private val threadMembers: ThreadMemberRepository,
    private val access: TeamAccess,
    private val teamService: TeamService,
) : ThreadTeams {
    fun threadIdsOf(teamId: IdType): List<IdType> =
        teamChats.findByTeamId(teamId).mapNotNull { it.threadId }

    override fun teamsOf(threadId: Long): List<TeamDTO> =
        teamService.teamsByIds(teamChats.findByThreadId(threadId).mapNotNull { it.teamId })

    fun place(teamId: IdType, threadId: IdType) {
        if (!teamChats.existsByTeamIdAndThreadId(teamId, threadId)) {
            teamChats.save(TeamChat(teamId = teamId, threadId = threadId))
        }
    }

    fun unplace(teamId: IdType, threadId: IdType) =
        teamChats.deleteByTeamIdAndThreadId(teamId, threadId)

    @Transactional(readOnly = true)
    fun mayRead(userId: IdType, threadId: IdType): Boolean {
        if (threadMembers.findByThreadIdAndUserId(threadId, userId) != null) return true
        val mine = access.accessibleTeamIds(userId)
        return teamChats.findByThreadId(threadId).any { it.teamId in mine }
    }
}
