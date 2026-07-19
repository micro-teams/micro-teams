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

import app.microteams.agent.driver.AgentDriver
import app.microteams.agent.screen.AGENT_SCREEN_KIND
import app.microteams.agent.screen.AgentScreenRepository
import app.microteams.agent.screen.ScreenAgent
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
    drivers: List<AgentDriver>,
) {
    private val logger = LoggerFactory.getLogger(AgentReadopt::class.java)
    private val driversByName = drivers.associateBy { it.name }

    /**
     * Re-adopt every agent screen this module has on the machine that just connected.
     *
     * Idempotent by design, because attachMachine (hence this event) fires on *every* connect:
     * - A machine with no agent rows is a no-op (the loop body never runs).
     * - An agent already live in the registry is skipped — a machine flap while the server itself
     *   stayed up must not double-register it or re-drive a screen that never lost its driver. Only
     *   the genuine hot-upgrade case — rows exist but the registry is empty because this server
     *   process is new — does any work.
     */
    @EventListener
    @Transactional
    fun onMachineConnected(event: MachineConnectedEvent) {
        val rows = agentScreenRepository.findByMachineId(event.machineId)
        var readopted = 0
        for (row in rows) {
            if (agentRegistry.get(row.agentUserId) != null) continue // already live (a flap)
            val driver = driversByName[row.driver]
            if (driver == null) {
                logger.warn(
                    "cannot readopt screen {} on machine {}: unknown driver {}",
                    row.sid,
                    row.machineId,
                    row.driver,
                )
                continue
            }
            // Re-register the screen in the hub off the persisted token (no session.create yet), so
            // its token is known, then send the adopt session.create that re-drives the surviving
            // tmux. Reconstruct the ScreenAgent from the row so chat can reach it again.
            hub.adoptScreen(row.sid, row.machineId, row.token, AGENT_SCREEN_KIND)
            // Empty command is deliberate: it makes this a *pure adopt*. The frozen CLI adopts the
            // tmux when the session survives (re-driving the running program and hot-reloading the
            // applet), but if the session is gone it would otherwise SPAWN m.command fresh — which
            // for a dead agent screen is a zombie resurrection with a blank transcript. An empty
            // command turns that dead path into a harmless `terminal: empty command` session.error
            // instead of a respawn, so a screen that truly died is never brought back as a zombie.
            hub.readoptScreen(
                machineId = row.machineId,
                sid = row.sid,
                command = emptyList(),
                appletSource = driver.appletSource,
            )
            agentRegistry.register(
                ScreenAgent(
                    userId = row.agentUserId,
                    sid = row.sid,
                    machineId = row.machineId,
                    teamId = row.teamId,
                    screenToken = row.token,
                    driver = driver,
                    hub = hub,
                )
            )
            readopted++
        }
        if (readopted > 0) {
            logger.info("re-adopted {} agent screen(s) on machine {}", readopted, event.machineId)
        }
    }
}
