/*
 *  Description: Announces the machine hub's in-memory screen state as a source of changes, the one
 *               kind of data answers are made from that lives in no table: a screen's state
 *               (starting, live, dead) and the variables its applet pushes (status, elapsed time,
 *               the question it asks). Reads of it are recorded by MachineHub.screen; this bean
 *               publishes HUB_SOURCE whenever either changes, so an answer that showed them is made
 *               again.
 *
 *               HubChanges(hub, bus) — a Spring bean; nothing to call.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.live

import app.microteams.common.live.ChangeBus
import app.microteams.machine.link.HUB_SOURCE
import app.microteams.machine.link.MachineHub
import app.microteams.machine.link.ScreenLifecycleListener
import app.microteams.machine.link.ScreenVarListener
import org.springframework.stereotype.Component

@Component
class HubChanges(hub: MachineHub, bus: ChangeBus) {
    init {
        hub.addScreenLifecycleListener(ScreenLifecycleListener { _, _ -> bus.publish(HUB_SOURCE) })
        hub.addScreenVarListener(ScreenVarListener { _, _, _ -> bus.publish(HUB_SOURCE) })
    }
}
