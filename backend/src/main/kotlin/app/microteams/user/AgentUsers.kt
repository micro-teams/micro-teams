/*
 *  Description: "Which of these users are agents?" — asked by modules that must not know what an
 *               agent is.
 *
 *               Chat needs the answer (a group whose only non-human member is one agent is drawn
 *               with that agent's avatar) but may never import the agent module: the dependency
 *               runs agent -> chat, and reversing it would let chat's tables and chat's meaning of
 *               membership leak into the orchestrator. The same shape solved this twice already —
 *               ChatSubscriber (chat does not look agents up; they register with it) and
 *               ScreenAttachPreflight (the machine layer asks a general question about a screen) —
 *               so this is that seam a third time, declared in `user` because "is this user an
 *               agent" is a fact about a user and both sides already depend on `user`.
 *
 *               Batched on purpose: a caller answers a whole page of members in one call rather
 *               than asking per member, which is what keeps this from becoming an N+1.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.user

import org.rucca.cheese.common.persistent.IdType

fun interface AgentUsers {
    /** Of [userIds], those that are agents. Ids that are not agents are simply absent. */
    fun agentsAmong(userIds: Collection<IdType>): Set<IdType>
}
