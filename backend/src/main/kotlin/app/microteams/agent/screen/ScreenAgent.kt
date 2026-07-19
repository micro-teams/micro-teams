/*
 *  Description: An agent backed by a live screen on a machine — the only kind we have today, and
 *               the reason Agent itself mentions none of this. It is told a group message by having
 *               the driver's applet type it into the program's terminal (`say`), and it answers by
 *               running `microteams api say` back to the group as itself — an ordinary member
 *               posting an ordinary message. How to be heard is a standing instruction the driver
 *               injects once at launch (see ClaudeDriver), so each message we type is just the
 *               message, not a repeated how-to.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.agent.screen

import app.microteams.agent.Agent
import app.microteams.agent.driver.AgentDriver
import app.microteams.machine.link.MachineHub
import org.rucca.cheese.common.persistent.IdType

/** The screen kind agents run under. Opaque to the machine layer; it only lets us find our own. */
const val AGENT_SCREEN_KIND = "agent"

class ScreenAgent(
    override val userId: IdType,
    val sid: String,
    val machineId: String,
    val teamId: IdType?,
    val screenToken: String,
    val driver: AgentDriver,
    private val hub: MachineHub,
) : Agent {

    override fun tell(threadId: IdType, speaker: String, text: String) {
        hub.callScreen(machineId, sid, "say", listOf(prompt(threadId, speaker, text)))
    }

    /**
     * How a group message is put to the agent: the message, tagged with the thread it came in and
     * who spoke, plus a one-line reminder of the reply channel. In principle the how-to-reply lives
     * in the driver's standing system prompt (injected once at launch), but weaker models drift and
     * start "replying" by just typing into their terminal — where nobody can see it. Repeating the
     * channel on every message, with the concrete thread id filled in, keeps it in immediate
     * context and copy-pasteable, so the agent actually reaches the group.
     */
    private fun prompt(threadId: IdType, speaker: String, text: String): String =
        "[thread:$threadId] $speaker：$text\n" +
            "(Reminder: the user cannot see anything you type here. To reply so the user sees it, " +
            "you MUST run: microteams api say --thread-id $threadId --text '<your reply>')"
}
