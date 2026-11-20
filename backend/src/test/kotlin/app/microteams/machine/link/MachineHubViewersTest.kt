/*
 *  Description: MachineHub's viewers, in both protocol versions, driven with in-process fakes (no
 *               WebSocket, no machine, no DB — the hub is I/O-free by design).
 *
 *               Protocol 2: each viewer is subscribed under its own id at its own size; what the
 *               machine says for a viewer (data, size, lease, capture, error) reaches that viewer
 *               only; readopt and respawn resubscribe every viewer with its id and last size; detach
 *               unsubscribes that viewer alone.
 *               Protocol 1: the old shared messages (no viewer field), the viewer's size echoed
 *               before the subscribe, screen.data fanned out, `viewerLevel` following input and the
 *               lease, and capture answered at once with an error.
 *               And the machine itself: nothing is sent before attachMachine (the hello), and
 *               welcome carries the version spoken.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.machine.link

import java.util.Base64
import java.util.concurrent.CopyOnWriteArrayList
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class MachineHubViewersTest {

    /** Records what a viewer is told, as short strings, in order. */
    private class Seen : ViewerSink {
        val events = CopyOnWriteArrayList<String>()

        override fun bytes(data: ByteArray) {
            events.add("bytes:" + String(data))
        }

        override fun size(cols: Int, rows: Int) {
            events.add("size:${cols}x$rows")
        }

        override fun lease(holder: String) {
            events.add("lease:$holder")
        }

        override fun capture(id: String, text: String?, error: String?) {
            events.add("capture:$id:$text:$error")
        }

        override fun error(text: String) {
            events.add("error:$text")
        }
    }

    private fun hub(protocol: Int): Pair<MachineHub, MutableList<LinkMsg>> {
        val hub = MachineHub()
        val sent = CopyOnWriteArrayList<LinkMsg>()
        hub.attachMachine("m1", MachineTransport { sent.add(it) }, protocol)
        return hub to sent
    }

    private fun b64(s: String) = Base64.getEncoder().encodeToString(s.toByteArray())

    @Test
    fun `welcome carries the version spoken, and only after attach`() {
        val sent = CopyOnWriteArrayList<LinkMsg>()
        val hub = MachineHub()
        assertTrue(!hub.isOnline("m1"))
        hub.attachMachine("m1", MachineTransport { sent.add(it) }, 2)
        assertEquals("welcome", sent[0].t)
        assertEquals(2, sent[0].v)
        assertEquals(2, hub.protocolOf("m1"))
        // A newer connector than this server is spoken to in the newest version this server knows.
        hub.attachMachine("m1", MachineTransport { sent.add(it) }, 3)
        assertEquals(2, sent.last { it.t == "welcome" }.v)
    }

    @Test
    fun `v2 subscribes each viewer under its own id at its own size`() {
        val (hub, sent) = hub(2)
        val screen = hub.openScreen("m1", listOf("bash"), kind = "test")
        sent.clear()
        hub.attachViewer(screen.sid, HubViewer("va", Seen(), 100, 30))
        hub.attachViewer(screen.sid, HubViewer("vb", Seen(), 60, 20))
        val subs = sent.filter { it.t == "screen.subscribe" }
        assertEquals(listOf("va" to 100, "vb" to 60), subs.map { it.viewer to it.cols })
        assertEquals(listOf(30, 20), subs.map { it.rows })
        assertTrue(sent.none { it.t == "var.set" }, "protocol 2 has no viewerLevel")
    }

    @Test
    fun `v2 routes what the machine says to the one viewer it names`() {
        val (hub, _) = hub(2)
        val screen = hub.openScreen("m1", listOf("bash"), kind = "test")
        val a = Seen()
        val b = Seen()
        hub.attachViewer(screen.sid, HubViewer("va", a, 80, 24))
        hub.attachViewer(screen.sid, HubViewer("vb", b, 80, 24))
        val sid = screen.sid
        hub.onMachineMessage(
            "m1",
            LinkMsg(t = "screen.size", sid = sid, viewer = "va", cols = 80, rows = 24),
        )
        hub.onMachineMessage(
            "m1",
            LinkMsg(t = "screen.data", sid = sid, viewer = "va", data = b64("hi")),
        )
        hub.onMachineMessage(
            "m1",
            LinkMsg(t = "screen.lease.state", sid = sid, viewer = "vb", holder = "va"),
        )
        hub.onMachineMessage("m1", LinkMsg(t = "screen.lease.state", sid = sid, viewer = "va"))
        hub.onMachineMessage(
            "m1",
            LinkMsg(
                t = "screen.capture.result",
                sid = sid,
                viewer = "vb",
                id = "c1",
                data = b64("text"),
            ),
        )
        hub.onMachineMessage(
            "m1",
            LinkMsg(t = "screen.error", sid = sid, viewer = "vb", error = "gone"),
        )
        // The size comes before the data drawn at it, in the order the machine said them.
        assertEquals(listOf("size:80x24", "bytes:hi", "lease:"), a.events)
        assertEquals(listOf("lease:va", "capture:c1:text:null", "error:gone"), b.events)
    }

    @Test
    fun `v2 viewer messages carry the viewer id`() {
        val (hub, sent) = hub(2)
        val screen = hub.openScreen("m1", listOf("bash"), kind = "test")
        hub.attachViewer(screen.sid, HubViewer("va", Seen(), 80, 24))
        sent.clear()
        hub.viewerInput(screen.sid, "va", "x".toByteArray())
        hub.viewerResize(screen.sid, "va", 90, 25)
        hub.viewerAck(screen.sid, "va", 512)
        hub.viewerLease(screen.sid, "va", "release")
        hub.viewerCapture(screen.sid, "va", "c9")
        hub.viewerScroll(screen.sid, "up") // protocol 1 only: ignored
        hub.viewerControl(screen.sid, "full") // protocol 1 only: ignored
        hub.detachViewer(screen.sid, "va")
        assertEquals(
            listOf(
                "screen.input",
                "screen.resize",
                "screen.ack",
                "screen.lease",
                "screen.capture",
                "screen.unsubscribe",
            ),
            sent.map { it.t },
        )
        assertTrue(sent.all { it.viewer == "va" })
        assertEquals(b64("x"), sent[0].data)
        assertEquals(512, sent[2].n)
        assertEquals("release", sent[3].op)
        assertEquals("c9", sent[4].id)
    }

    @Test
    fun `v2 readopt and respawn resubscribe every viewer with its id and last size`() {
        val (hub, sent) = hub(2)
        val screen = hub.adoptScreen("s1", "m1", token = "tok1", kind = "agent")
        hub.attachViewer("s1", HubViewer("va", Seen(), 80, 24))
        hub.attachViewer("s1", HubViewer("vb", Seen(), 120, 40))
        hub.viewerResize("s1", "vb", 100, 30)
        sent.clear()

        hub.readoptScreen("m1", "s1", emptyList(), "// src", vars = mapOf("operatorPrompt" to "p"))
        assertEquals(
            listOf("session.create", "var.set", "screen.subscribe", "screen.subscribe"),
            sent.map { it.t },
        )
        assertEquals("operatorPrompt", sent[1].name)
        val subs =
            sent.filter { it.t == "screen.subscribe" }.map { "${it.viewer}:${it.cols}x${it.rows}" }
        assertEquals(setOf("va:80x24", "vb:100x30"), subs.toSet())
        sent.clear()

        hub.respawnScreen("m1", screen.sid, listOf("bash", "--resume"))
        assertEquals(
            listOf("session.close", "session.create", "screen.subscribe", "screen.subscribe"),
            sent.map { it.t },
        )
        assertEquals(2L, screen.generation.get(), "each create is a new generation")
    }

    @Test
    fun `v1 speaks the shared messages and echoes the viewer's size before its data`() {
        val (hub, sent) = hub(1)
        val screen = hub.openScreen("m1", listOf("bash"), kind = "test")
        sent.clear()
        val a = Seen()
        val b = Seen()
        hub.attachViewer(screen.sid, HubViewer("va", a, 100, 30))
        hub.attachViewer(screen.sid, HubViewer("vb", b, 80, 24))
        hub.onMachineMessage("m1", LinkMsg(t = "screen.data", sid = screen.sid, data = b64("hi")))
        assertEquals(listOf("size:100x30", "bytes:hi"), a.events)
        assertEquals(listOf("size:80x24", "bytes:hi"), b.events)
        hub.viewerResize(screen.sid, "va", 90, 20)
        assertEquals("size:90x20", a.events.last())
        assertTrue(sent.all { it.viewer == null }, "protocol 1 has no viewer field")
        assertEquals(
            listOf("screen.subscribe", "screen.subscribe", "screen.resize"),
            sent.map { it.t },
        )
    }

    @Test
    fun `v1 maps input and the lease onto viewerLevel, setting it only when it changes`() {
        val (hub, sent) = hub(1)
        val screen = hub.openScreen("m1", listOf("bash"), kind = "test")
        hub.attachViewer(screen.sid, HubViewer("va", Seen(), 80, 24))
        hub.attachViewer(screen.sid, HubViewer("vb", Seen(), 80, 24))
        sent.clear()
        fun levels() = sent.filter { it.t == "var.set" }.map { it.value }

        hub.viewerInput(screen.sid, "va", "x".toByteArray())
        hub.viewerInput(screen.sid, "va", "y".toByteArray())
        hub.viewerLease(screen.sid, "vb", "take")
        assertEquals(listOf("full"), levels(), "full once, however many keys")
        hub.viewerLease(screen.sid, "va", "release")
        assertEquals(listOf("full"), levels(), "another viewer still holds it")
        hub.detachViewer(screen.sid, "vb")
        assertEquals(listOf("full", "passive"), levels())
        assertEquals(
            1,
            sent.count { it.t == "screen.input" && it.viewer == null && it.data == b64("x") },
        )
        assertTrue(sent.none { it.t == "screen.unsubscribe" }, "one viewer is still watching")
        hub.detachViewer(screen.sid, "va")
        assertEquals("screen.unsubscribe", sent.last().t)
    }

    @Test
    fun `v1 cannot capture or ack, and says so`() {
        val (hub, sent) = hub(1)
        val screen = hub.openScreen("m1", listOf("bash"), kind = "test")
        val a = Seen()
        hub.attachViewer(screen.sid, HubViewer("va", a, 80, 24))
        sent.clear()
        hub.viewerCapture(screen.sid, "va", "c1")
        hub.viewerAck(screen.sid, "va", 100)
        assertTrue(sent.isEmpty())
        assertTrue(
            a.events.last().startsWith("capture:c1:null:this machine's connector is too old"),
        )
    }

    @Test
    fun `v1 readopt resubscribes once with the last size and tells every viewer`() {
        val (hub, sent) = hub(1)
        hub.adoptScreen("s1", "m1", token = "tok1", kind = "agent")
        val a = Seen()
        hub.attachViewer("s1", HubViewer("va", a, 80, 24))
        hub.attachViewer("s1", HubViewer("vb", Seen(), 100, 30))
        sent.clear()
        hub.readoptScreen("m1", "s1", emptyList(), "// src")
        val subs = sent.filter { it.t == "screen.subscribe" }
        assertEquals(1, subs.size)
        assertEquals(100, subs[0].cols)
        assertEquals("size:100x30", a.events.last())
    }

    @Test
    fun `v1 reports an adopt of a session that did not survive truthfully`() {
        val (hub, _) = hub(1)
        hub.adoptScreen("s1", "m1", token = "tok1", kind = "agent")
        hub.onMachineMessage(
            "m1",
            LinkMsg(t = "session.error", sid = "s1", error = "terminal: empty command"),
        )
        assertEquals(ScreenState.DEAD, hub.screen("s1")!!.state)
        assertEquals(
            "the screen's program is no longer running on this machine",
            hub.screen("s1")!!.deadReason,
        )
    }

    @Test
    fun `a call ends when its machine connects again`() {
        val (hub, _) = hub(2)
        val screen = hub.openScreen("m1", listOf("bash"), kind = "test")
        val call = hub.callScreen("m1", screen.sid, "say", listOf("hi", "m1"))
        hub.attachMachine("m1", MachineTransport {}, 2)
        val e = runCatching { call.join() }.exceptionOrNull()
        assertTrue(e?.cause is LinkClosedException, "got $e")
    }
}
