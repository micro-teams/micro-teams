/*
 *  Description: The one place that turns an AgentScreen row into live state, and the answer to a
 *               question this module kept answering three times.
 *
 *               An agent's existence is spread over one durable fact and two in-memory ones: the
 *               row (which screen, on which machine, running which driver and session), its
 *               registration in the MachineHub (so the machine layer can route to it), and its
 *               registration in the AgentRegistry (so chat can reach it). The row is the truth;
 *               the other two are caches this server rebuilds. Three paths used to rebuild them
 *               independently — opening an agent, re-adopting on a machine connect, and repairing
 *               on a viewer attach — each with its own copy of "construct a ScreenAgent from these
 *               fields", and each free to drift from the others. That drift is exactly how a
 *               screen ends up half-known: registered in one map and missing from the other,
 *               believed online while nothing routes to it.
 *
 *               So there is one idempotent [adopt]: given a row, make both caches match it and
 *               hand back the agent. Callers say what they know (a row) rather than how to
 *               rebuild what follows from it.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.agent.screen

import app.microteams.agent.AgentRegistry
import app.microteams.agent.AgentWakeup
import app.microteams.agent.driver.AgentDriver
import app.microteams.machine.link.MachineHub
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.ObjectProvider
import org.springframework.stereotype.Component

@Component
class AgentScreens(
    private val hub: MachineHub,
    private val agentRegistry: AgentRegistry,
    // Late-bound: a ScreenAgent is handed the wake-up so a message to a dead agent revives it, and
    // the wake-up in turn adopts through here. Nothing is resolved until the first adopt.
    private val agentWakeup: ObjectProvider<AgentWakeup>,
    drivers: List<AgentDriver>,
) {
    private val logger = LoggerFactory.getLogger(AgentScreens::class.java)
    private val driversByName = drivers.associateBy { it.name }

    /** The driver [row] runs, or null (with a warning) if this server does not have it. */
    fun driverOf(row: AgentScreen): AgentDriver? =
        driversByName[row.driver]
            ?: run {
                logger.warn(
                    "agent {} on screen {} runs driver '{}', which this server does not have",
                    row.agentUserId,
                    row.sid,
                    row.driver,
                )
                null
            }

    /**
     * Make this server's live state match [row], and return the agent it describes.
     *
     * Idempotent in both halves and safe to call from anywhere, however much or little is already
     * in place: a screen the hub already knows keeps its live state (its viewers, its mirrored
     * variables, whether its program is believed alive), and an agent already registered keeps its
     * entry rather than being replaced by an equal one — re-registering would swap the object chat
     * holds for no reason. Returns null only when the driver is unknown, which is the one thing
     * that cannot be rebuilt from the row.
     *
     * Note what this does NOT do: it never touches the machine. Whether the program is still
     * running there is a question only the machine can answer, and asking it is the caller's job —
     * the connect path asks with an adopt, the viewer path asks the applet directly.
     */
    fun adopt(row: AgentScreen): ScreenAgent? {
        val driver = driverOf(row) ?: return null
        if (hub.screen(row.sid) == null) {
            hub.adoptScreen(row.sid, row.machineId, row.token, AGENT_SCREEN_KIND)
        }
        val existing = agentRegistry.bySid(row.sid)
        if (existing != null) return existing
        val agent =
            ScreenAgent(
                userId = row.agentUserId,
                sid = row.sid,
                machineId = row.machineId,
                teamId = row.teamId,
                screenToken = row.token,
                driver = driver,
                hub = hub,
                wakeup = agentWakeup.getObject(),
            )
        agentRegistry.register(agent)
        return agent
    }
}
