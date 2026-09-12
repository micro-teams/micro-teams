/*
 *  Description: Regression test for T-089: a viewer that was already attached to a screen when its
 *               sid gets reused — wakeAgent's respawnScreen, or a machine reconnect's readoptScreen
 *               — must keep receiving screen data, not go permanently dark.
 *
 *               MachineHub is I/O-free by design (see its header), so this drives it directly with
 *               in-process fakes: no WebSocket, no machine, no DB. The bug is invisible from the
 *               wire's shape (the viewer's handshake never changes) and only shows up as "was
 *               screen.subscribe re-sent to the machine", which is exactly what these tests assert.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.machine.link

import java.util.concurrent.CopyOnWriteArrayList
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class MachineHubResubscribeTest {

    private fun newHub(): Pair<MachineHub, MutableList<LinkMsg>> {
        val hub = MachineHub()
        val sent = CopyOnWriteArrayList<LinkMsg>()
        hub.attachMachine("m1", MachineTransport { sent.add(it) })
        sent.clear() // drop welcome / machine.info
        return hub to sent
    }

    @Test
    fun `respawnScreen resubscribes a viewer that was already attached`() {
        val (hub, sent) = newHub()
        val screen = hub.openScreen("m1", listOf("bash"), kind = "test", appletSource = "// src")
        sent.clear()

        // A viewer is already watching this screen when the agent dies and gets woken in place.
        hub.attachViewer("m1", screen.sid, ViewerTransport {})
        assertTrue(sent.any { it.t == "screen.subscribe" }, "first viewer must subscribe")
        sent.clear()

        // wakeAgent's path: same sid, machine tears the tmux down and spawns it fresh.
        val respawned = hub.respawnScreen("m1", screen.sid, listOf("bash", "--resume"))
        assertTrue(respawned)
        assertTrue(sent.any { it.t == "session.close" })
        assertTrue(sent.any { it.t == "session.create" })
        // Without a fresh screen.subscribe, the freshly spawned session never streams to the
        // viewer that survived the respawn: a silent, permanent black screen.
        assertTrue(
            sent.any { it.t == "screen.subscribe" },
            "respawn must re-subscribe a viewer that predates it",
        )
    }

    @Test
    fun `respawnScreen sends no extra subscribe when nobody is watching`() {
        val (hub, sent) = newHub()
        val screen = hub.openScreen("m1", listOf("bash"), kind = "test", appletSource = "// src")
        sent.clear()

        hub.respawnScreen("m1", screen.sid, listOf("bash", "--resume"))
        assertTrue(
            sent.none { it.t == "screen.subscribe" },
            "nothing to resubscribe when there are no viewers",
        )
    }

    @Test
    fun `readoptScreen resubscribes a viewer that survived a machine reconnect`() {
        val (hub, sent) = newHub()
        // The screen already exists here (the server process never restarted) — this is what
        // AgentScreens#adopt leaves behind when hub.screen(sid) is already non-null.
        val screen = hub.adoptScreen("s1", "m1", token = "tok1", kind = "agent")
        hub.attachViewer("m1", screen.sid, ViewerTransport {})
        sent.clear()

        // The reconnecting CLI is a brand-new process; it remembers no prior subscription.
        hub.readoptScreen(
            machineId = "m1",
            sid = screen.sid,
            command = emptyList(),
            appletSource = "// src",
        )
        assertTrue(sent.any { it.t == "session.create" && it.adopt == true })
        assertTrue(
            sent.any { it.t == "screen.subscribe" },
            "readopt must re-subscribe a viewer that predates the reconnect",
        )
    }

    @Test
    fun `readoptScreen sends no extra subscribe when nobody is watching`() {
        val (hub, sent) = newHub()
        val screen = hub.adoptScreen("s1", "m1", token = "tok1", kind = "agent")
        sent.clear()

        hub.readoptScreen(
            machineId = "m1",
            sid = screen.sid,
            command = emptyList(),
            appletSource = "// src",
        )
        assertTrue(sent.none { it.t == "screen.subscribe" })
    }
}
