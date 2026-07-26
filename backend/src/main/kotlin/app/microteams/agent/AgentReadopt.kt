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
) {
    private val logger = LoggerFactory.getLogger(AgentReadopt::class.java)

    /**
     * Re-adopt every agent screen this module has on the machine that just connected.
     *
     * Every connect re-drives every screen, and only *registering* is conditional. It used to skip
     * an agent already in the registry entirely, reading "we still have it in memory" as "its
     * screen survived" — true when the server was what restarted, false when the MACHINE was. A
     * machine that reboots loses its tmux (the socket lives under /tmp) while the server keeps its
     * registry, so those agents were skipped, never probed, and became ghosts: registered, believed
     * alive, with nothing behind them. Messages were typed into the void and the live screen opened
     * onto a session the machine no longer had — and no signal could ever correct it, because the
     * death notice is exactly what the skipped adopt would have produced.
     *
     * Idempotent by design, because attachMachine (hence this event) fires on *every* connect:
     * - A machine with no agent rows is a no-op (the loop body never runs).
     * - A screen whose tmux did survive is simply re-driven and its applet hot-reloaded, which is
     *   what an adopt does to a live session anyway.
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
            // deliberate: it makes this a *pure adopt*. The frozen CLI adopts the tmux when the
            // session survives (re-driving the running program and hot-reloading the applet), but
            // if the session is gone it would otherwise SPAWN m.command fresh — which for a dead
            // agent screen is a zombie resurrection with a blank transcript. An empty command turns
            // that dead path into a harmless `terminal: empty command` session.error instead of a
            // respawn: the screen is marked dead and waits to be woken, never revived blank.
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
    }
}
