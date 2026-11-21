/*
 *  Description: MachineHub's viewers, driven with in-process fakes (no WebSocket, no machine, no
 *               DB — the hub is I/O-free by design).
 *
 *               Each viewer is subscribed under its own id at its own size; what the
 *               machine says for a viewer (data, size, lease, capture, error) reaches that viewer
 *               only; readopt and respawn resubscribe every viewer with its id and last size; detach
 *               unsubscribes that viewer alone; `viewerLevel` is full exactly while a viewer holds
 *               the lease, and set passive after every session.create and again on screenReady.
 *               And the machine itself: nothing is sent before attachMachine (the hello), and
 *               welcome carries the server's version.
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

        override fun resubscribed() {
            events.add("resubscribed")
        }
    }

    private fun hub(): Pair<MachineHub, MutableList<LinkMsg>> {
        val hub = MachineHub()
        val sent = CopyOnWriteArrayList<LinkMsg>()
        hub.attachMachine("m1", MachineTransport { sent.add(it) })
        return hub to sent
    }

    private fun b64(s: String) = Base64.getEncoder().encodeToString(s.toByteArray())

    @Test
    fun `welcome carries the server's version, and only after attach`() {
        val sent = CopyOnWriteArrayList<LinkMsg>()
        val hub = MachineHub()
        assertTrue(!hub.isOnline("m1"))
        hub.attachMachine("m1", MachineTransport { sent.add(it) })
        assertTrue(hub.isOnline("m1"))
        assertEquals("welcome", sent[0].t)
        assertEquals(PROTOCOL_VERSION, sent[0].v)
    }

    @Test
    fun `subscribes each viewer under its own id at its own size`() {
        val (hub, sent) = hub()
        val screen = hub.openScreen("m1", listOf("bash"), kind = "test")
        sent.clear()
        hub.attachViewer(screen.sid, HubViewer("va", Seen(), 100, 30))
        hub.attachViewer(screen.sid, HubViewer("vb", Seen(), 60, 20))
        val subs = sent.filter { it.t == "screen.subscribe" }
        assertEquals(listOf("va" to 100, "vb" to 60), subs.map { it.viewer to it.cols })
        assertEquals(listOf(30, 20), subs.map { it.rows })
        assertTrue(sent.none { it.t == "var.set" }, "attaching leaves viewerLevel alone")
    }

    @Test
    fun `routes what the machine says to the one viewer it names`() {
        val (hub, _) = hub()
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
    fun `viewer messages carry the viewer id`() {
        val (hub, sent) = hub()
        val screen = hub.openScreen("m1", listOf("bash"), kind = "test")
        hub.attachViewer(screen.sid, HubViewer("va", Seen(), 80, 24))
        sent.clear()
        hub.viewerInput(screen.sid, "va", "x".toByteArray())
        hub.viewerResize(screen.sid, "va", 90, 25)
        hub.viewerAck(screen.sid, "va", 512)
        hub.viewerLease(screen.sid, "va", "release")
        hub.viewerCapture(screen.sid, "va", "c9")
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
    fun `readopt and respawn resubscribe every viewer with its id and last size`() {
        val (hub, sent) = hub()
        val screen = hub.adoptScreen("s1", "m1", token = "tok1", kind = "agent")
        hub.attachViewer("s1", HubViewer("va", Seen(), 80, 24))
        hub.attachViewer("s1", HubViewer("vb", Seen(), 120, 40))
        hub.viewerResize("s1", "vb", 100, 30)
        sent.clear()

        hub.readoptScreen("m1", "s1", emptyList(), "// src")
        assertEquals(
            listOf("session.create", "var.set", "screen.subscribe", "screen.subscribe"),
            sent.map { it.t },
        )
        assertEquals("viewerLevel" to "passive", sent[1].name to sent[1].value)
        val subs =
            sent.filter { it.t == "screen.subscribe" }.map { "${it.viewer}:${it.cols}x${it.rows}" }
        assertEquals(setOf("va:80x24", "vb:100x30"), subs.toSet())
        sent.clear()

        hub.respawnScreen("m1", screen.sid, listOf("bash", "--resume"))
        assertEquals(
            listOf(
                "session.close",
                "session.create",
                "var.set",
                "screen.subscribe",
                "screen.subscribe",
            ),
            sent.map { it.t },
        )
        assertEquals(2L, screen.generation.get(), "each create is a new generation")
    }

    @Test
    fun `sets viewerLevel full exactly while a viewer holds the lease`() {
        val (hub, sent) = hub()
        val screen = hub.openScreen("m1", listOf("bash"), kind = "test")
        val sid = screen.sid
        assertEquals("passive", sent.last { it.t == "var.set" }.value, "a new session's applet")
        hub.attachViewer(sid, HubViewer("va", Seen(), 80, 24))
        hub.attachViewer(sid, HubViewer("vb", Seen(), 80, 24))
        sent.clear()
        fun levels() = sent.filter { it.t == "var.set" }.map { it.name to it.value }
        fun lease(holder: String?) {
            for (v in listOf("va", "vb")) {
                hub.onMachineMessage(
                    "m1",
                    LinkMsg(t = "screen.lease.state", sid = sid, viewer = v, holder = holder),
                )
            }
        }

        lease("va")
        assertEquals(listOf("viewerLevel" to "full"), levels(), "once, though each viewer is told")
        lease(null)
        lease("driver")
        assertEquals(
            listOf("full", "passive"),
            levels().map { it.second },
            "the agent is no viewer",
        )
        lease("vb")
        sent.clear()
        hub.onMachineMessage(
            "m1",
            LinkMsg(t = "rpc.call", sid = sid, id = "c1", name = "screenReady"),
        )
        assertEquals(listOf("full"), levels().map { it.second }, "a loaded applet is told again")
        sent.clear()
        // The holder leaves: the machine frees the lease and tells only who is left, maybe nobody.
        hub.detachViewer(sid, "va")
        assertEquals(emptyList<Any>(), levels(), "va did not hold it")
        hub.detachViewer(sid, "vb")
        assertEquals(listOf("passive"), levels().map { it.second })
    }

    @Test
    fun `a call ends when its machine connects again`() {
        val (hub, _) = hub()
        val screen = hub.openScreen("m1", listOf("bash"), kind = "test")
        val call = hub.callScreen("m1", screen.sid, "say", listOf("hi", "m1"))
        hub.attachMachine("m1", MachineTransport {})
        val e = runCatching { call.join() }.exceptionOrNull()
        assertTrue(e?.cause is LinkClosedException, "got $e")
    }

    @Test
    fun `a terminal reply passes the lease`() {
        val (hub, sent) = hub()
        val screen = hub.openScreen("m1", listOf("bash"), kind = "test")
        hub.attachViewer(screen.sid, HubViewer("va", Seen(), 80, 24))
        sent.clear()
        hub.viewerReply(screen.sid, "va", "\u001b[?1;2c".toByteArray())
        assertEquals(listOf("screen.input"), sent.map { it.t })
        assertEquals("reply", sent[0].op)
        assertEquals("va", sent[0].viewer)
    }

    @Test
    fun `a viewer whose sink fails is unsubscribed`() {
        val (hub, sent) = hub()
        val screen = hub.openScreen("m1", listOf("bash"), kind = "test")
        val broken =
            object : ViewerSink by Seen() {
                override fun bytes(data: ByteArray) = throw IllegalStateException("socket gone")
            }
        hub.attachViewer(screen.sid, HubViewer("va", broken, 80, 24))
        sent.clear()
        hub.onMachineMessage(
            "m1",
            LinkMsg(t = "screen.data", sid = screen.sid, viewer = "va", data = b64("x")),
        )
        assertTrue(screen.viewers.isEmpty())
        assertEquals(listOf("screen.unsubscribe"), sent.map { it.t })
        assertEquals("va", sent[0].viewer)
    }

    @Test
    fun `an applet call is answered on the connection it came in on`() {
        val (hub, current) = hub()
        val screen = hub.openScreen("m1", listOf("bash"), kind = "test")
        val old = CopyOnWriteArrayList<LinkMsg>()
        val oldTransport = MachineTransport { old.add(it) }
        current.clear()
        hub.onMachineMessage(
            "m1",
            LinkMsg(t = "rpc.call", sid = screen.sid, id = "c1", name = "screenReady"),
            oldTransport,
        )
        assertEquals(listOf("rpc.result"), old.map { it.t })
        assertTrue(current.none { it.t == "rpc.result" }, "not on the newer connection")
        // A connection closed meanwhile drops the answer instead of failing the caller.
        hub.onMachineMessage(
            "m1",
            LinkMsg(t = "rpc.call", sid = screen.sid, id = "c2", name = "screenReady"),
            MachineTransport { throw IllegalStateException("closed") },
        )
    }

    @Test
    fun `a resubscribe tells every viewer so a repeated lease state is not read as an answer`() {
        val (hub, _) = hub()
        hub.adoptScreen("s1", "m1", token = "tok1", kind = "agent")
        val a = Seen()
        hub.attachViewer("s1", HubViewer("va", a, 80, 24))
        hub.readoptScreen("m1", "s1", emptyList(), "// src")
        assertEquals(listOf("resubscribed"), a.events)
    }
}
