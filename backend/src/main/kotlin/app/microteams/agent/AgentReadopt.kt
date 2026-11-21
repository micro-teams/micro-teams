/*
 *  Description: The other half of surviving a restart. When a backend redeploys (or a
 *               `microteams update` re-execs the CLI), the tmux screens keep running on their
 *               machines and the connector reconnects within seconds — but the server has lost the
 *               in-memory ScreenAgent map that made those screens agents, so they would show
 *               offline and their claude processes would pile up orphaned. The AgentScreen rows
 *               persist for exactly this: on a machine (re)connect the agent module re-adopts its
 *               own surviving screens off those rows and re-registers them, so an agent comes back
 *               online without a human reopening it.
 *
 *               It hangs off MachineConnectedEvent — the machine module only says "a machine
 *               connected", it never reaches into agent tables — mirroring how AgentCleanup listens
 *               to MachineForgottenEvent. The machine→agent dependency stays one-way.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.agent

import app.microteams.agent.screen.AgentScreenRepository
import app.microteams.agent.screen.AgentScreens
import app.microteams.machine.MachineConnectedEvent
import app.microteams.machine.link.MachineHub
import org.slf4j.LoggerFactory
import org.springframework.context.event.EventListener
import org.springframework.stereotype.Component
import org.springframework.transaction.annotation.Transactional

@Component
class AgentReadopt(
    private val agentScreenRepository: AgentScreenRepository,
    private val agentRegistry: AgentRegistry,
    private val hub: MachineHub,
    private val agentScreens: AgentScreens,
    private val wakeup: AgentWakeup,
) {
    private val logger = LoggerFactory.getLogger(AgentReadopt::class.java)

    /**
     * Re-adopt every agent screen this module has on the machine that just connected.
     *
     * Every connect re-drives every screen, and only *registering* is conditional. "We still have
     * it in memory" does not mean "its screen survived": a machine that reboots loses its tmux
     * while the server keeps its registry, and only the adopt makes the machine say so
     * (session.error).
     *
     * Idempotent by design, because this event fires on *every* connect:
     * - A machine with no agent rows is a no-op (the loop body never runs).
     * - A screen whose tmux did survive is simply re-driven (its applet reloaded only by a
     *   connector that lost it or runs another version of it).
     * - An agent already in the registry keeps its entry rather than being registered twice.
     */
    @EventListener
    @Transactional
    fun onMachineConnected(event: MachineConnectedEvent) {
        val rows = agentScreenRepository.findByMachineId(event.machineId)
        var readopted = 0
        for (row in rows) {
            // Everything that follows from the row — its hub registration, its registry entry —
            // is rebuilt in one place, so this path cannot drift from the other two that do it.
            val driver = agentScreens.driverOf(row) ?: continue
            agentScreens.adopt(row)
            // Then ask the machine whether the program is still there. Empty command is
            // deliberate: it makes this a *pure adopt*. The connector adopts the tmux when the
            // session survives, and reports session.error when it is gone instead of spawning a
            // blank program: the screen is marked dead and waits to be woken, never revived blank.
            hub.readoptScreen(
                machineId = row.machineId,
                sid = row.sid,
                command = emptyList(),
                appletSource = driver.appletSource,
            )
            readopted++
        }
        if (readopted > 0) {
            logger.info("re-drove {} agent screen(s) on machine {}", readopted, event.machineId)
        }
        // Messages whose send the old connection never answered go out on this one.
        wakeup.deliverOn(event.machineId)
    }
}
