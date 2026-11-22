/*
 *  Description: "Which teams is this thread in?" — asked by the chat module, answered by the team
 *               module, which owns that link (team/chat). Chat depends on nothing, so it declares
 *               the question and the team module implements it, the same seam AgentUsers is.
 *
 *               ThreadTeams.teamsOf(threadId) -> the teams the thread is in, in id order.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.chat.thread

import app.microteams.model.TeamDTO

fun interface ThreadTeams {
    fun teamsOf(threadId: Long): List<TeamDTO>
}
