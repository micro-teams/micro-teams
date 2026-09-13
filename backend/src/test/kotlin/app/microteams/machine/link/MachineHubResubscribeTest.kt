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

    // T-091: a second (or later) viewer attaching to a screen that already has a watcher used to
    // get NOTHING — the hub only ever subscribed on the *first* viewer, on the theory that the
    // machine's already-running client would cover everyone. It does not: a real tmux attach only
    // repaints for the client that causes it, and this codebase's own machine-side fix synthesizes
    // a snapshot from the pane precisely because subscribing is what triggers that now. If this
    // hub-side send stayed gated to "first viewer only", the machine-side fix would never even be
    // asked to run for a second viewer, and the black-screen bug would survive untouched.
    //
    // There used to be no test asserting "a second viewer does NOT get a redundant subscribe" —
    // nothing here is being corrected against a prior guarantee, this is filling a gap that was
    // never covered at all.
    @Test
    fun `attachViewer subscribes every viewer, not just the first`() {
        val (hub, sent) = newHub()
        val screen = hub.openScreen("m1", listOf("bash"), kind = "test", appletSource = "// src")
        sent.clear()

        hub.attachViewer("m1", screen.sid, ViewerTransport {})
        assertTrue(sent.any { it.t == "screen.subscribe" }, "first viewer must subscribe")
        sent.clear()

        // A second viewer joins while the first is still attached — the machine already has a
        // client running for this screen, yet the second viewer must still be asked for, so the
        // machine gets a chance to hand it a snapshot instead of leaving it blank.
        hub.attachViewer("m1", screen.sid, ViewerTransport {})
        assertTrue(
            sent.any { it.t == "screen.subscribe" },
            "a second viewer joining an already-watched screen must also trigger a screen.subscribe, " +
                "so the machine can answer it — without this the second viewer never receives an " +
                "initial screen and stays blank/stale until an unrelated future change happens to " +
                "repaint over it",
        )
    }
}
