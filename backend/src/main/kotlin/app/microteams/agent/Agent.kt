/*
 *  Description: What an agent *is*, kept as small as it can be: a user that software drives.
 *               Deliberately says nothing about machines, screens or drivers — a ScreenAgent
 *               (agent/screen) is only the implementation we happen to have today, and an agent
 *               that lives entirely server-side, or on something that is not a terminal at all,
 *               must be able to implement this without pretending to own a screen.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.agent

import org.rucca.cheese.common.persistent.IdType

/** An agent is a user that software drives. */
interface Agent {
    /** The real user row it acts as (一个 agent 就是一个用户). */
    val userId: IdType

    /**
     * Something was said to this agent in a group it belongs to. Delivery is best-effort and
     * fire-and-forget: the agent answers, if it answers at all, by calling back in through the
     * tool-door as itself — never by returning a value here.
     */
    fun tell(threadId: IdType, speaker: String, text: String)
}
