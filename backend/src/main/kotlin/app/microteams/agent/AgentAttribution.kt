/*
 *  Description: The attribution seam — machine token + screen token → actor. Every agent
 *               tool-door call carries a machine token (Authorization: Bearer, the CLI's
 *               config token) and, when made from inside a screen, that screen's token
 *               (X-Microteams-Screen). A screen *is* an agent, so a call from inside one acts
 *               as that screen's agent user; the screen token is honored only when it names
 *               a screen belonging to *this* machine (a token from another machine's screen is
 *               ignored, never trusted, so it can never escalate across machines).
 *
 *               Our team model is owner-less, so there is no machine-owner actor: a bare
 *               machine call (no valid screen) has no actor and cannot act as a user.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.agent

import app.microteams.machine.enrollment.Machine
import app.microteams.machine.enrollment.MachineService
import app.microteams.machine.link.HubScreen
import app.microteams.machine.link.MachineHub
import org.springframework.stereotype.Component

/** Who a connector call acts as. [screen] is non-null only for a call from inside a screen. */
data class Attribution(val machine: Machine, val screen: HubScreen?) {
    val insideScreen: Boolean
        get() = screen != null
}

@Component
class AgentAttribution(private val machineService: MachineService, private val hub: MachineHub) {
    /** Resolve a call to its actor, or null if the machine token is unknown. */
    fun resolve(machineToken: String?, screenToken: String?): Attribution? {
        if (machineToken.isNullOrBlank()) return null
        val machine = machineService.verifyToken(machineToken) ?: return null
        var screen: HubScreen? = null
        if (!screenToken.isNullOrBlank()) {
            val candidate = hub.screenByToken(screenToken)
            if (candidate != null && candidate.machineId == machine.machineId) {
                screen = candidate
            }
        }
        return Attribution(machine, screen)
    }
}
