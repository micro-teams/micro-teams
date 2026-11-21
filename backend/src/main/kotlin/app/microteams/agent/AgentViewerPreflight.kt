/*
 *  Description: Watching the live screen is the other moment an agent must be awake. Opening the
 *               live screen of an agent whose program died would otherwise show the frozen last
 *               frame of whatever killed it — a dead tmux pane that no keystroke reaches — and the
 *               human has no way to tell that from an agent that is merely quiet.
 *
 *               So the agent module answers the machine layer's "anything to do before this
 *               attach?" by waking its own. The machine layer stays ignorant of agents: it asks a
 *               general question about a screen and gets back the screen to attach to.
 *
 *               It answers the other viewer question too, which buttons to offer: the applet
 *               functions the agent's driver lets a viewer call (AgentDriver.viewerCommands).
 *
 *               AgentViewerPreflight: beforeAttach(sid) -> sid; commandsOf(sid) -> names.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.agent

import app.microteams.agent.screen.AgentScreenRepository
import app.microteams.agent.screen.AgentScreens
import app.microteams.machine.screen.ScreenAttachPreflight
import app.microteams.machine.screen.ScreenCommands
import org.springframework.stereotype.Component

@Component
class AgentViewerPreflight(
    private val wakeup: AgentWakeup,
    private val agentRegistry: AgentRegistry,
    private val agentScreenRepository: AgentScreenRepository,
    private val agentScreens: AgentScreens,
) : ScreenAttachPreflight, ScreenCommands {
    /**
     * A screen that belongs to no agent is returned untouched. An agent's is woken if its program
     * is gone; the sid comes back unchanged in the normal case, since waking respawns the screen in
     * place.
     */
    override fun beforeAttach(sid: String): String = wakeup.ensureAwakeForViewer(sid)

    /** The viewer commands of the driver the agent on [sid] runs; none for a screen of no agent. */
    override fun commandsOf(sid: String): List<String> =
        (agentRegistry.bySid(sid)?.driver
                ?: agentScreenRepository.findById(sid).orElse(null)?.let {
                    agentScreens.driverOf(it)
                })
            ?.viewerCommands
            .orEmpty()
}
