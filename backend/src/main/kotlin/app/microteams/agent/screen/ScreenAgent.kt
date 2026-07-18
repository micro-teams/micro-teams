/*
 *  Description: An agent backed by a live screen on a machine — the only kind we have today, and
 *               the reason Agent itself mentions none of this. It is told something by having the
 *               driver's applet type it into the program's terminal (`say`), and it answers by
 *               running `microteams api post-note` back through the tool-door as itself.
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
     * How a group message is put to the agent. This is about our tool-door rather than about any
     * one program, so it lives here and not in the driver: whatever drives the screen, the way to
     * be heard in a group is `microteams api post-note`, and nothing typed into the terminal
     * reaches the group by itself.
     */
    private fun prompt(threadId: IdType, speaker: String, text: String): String =
        "[thread:$threadId] $speaker：$text\n" +
            "（这是群聊消息。请用命令 `microteams api post-note 'text: 你的回复'` 把回复发回本群" +
            "（如需指定群可加 'thread_id: $threadId'）——群里的人只看得到你用 post-note 发出的话；" +
            "不需要回复就忽略。）"
}
