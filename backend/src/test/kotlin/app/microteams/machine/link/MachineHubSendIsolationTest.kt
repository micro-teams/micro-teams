/*
 *  Description: A send to a machine whose control-link session is already closed must not fail
 *               the caller. Tomcat throws IllegalStateException for a write against a closed
 *               session, and a viewer detaching (or attaching) right after its machine dropped
 *               would otherwise fail on it. HubMachine.send logs and drops such a write instead.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.machine.link

import org.junit.jupiter.api.Assertions.assertDoesNotThrow
import org.junit.jupiter.api.Test

/** A viewer that ignores everything it is told. */
private object NoSink : ViewerSink {
    override fun bytes(data: ByteArray) {}

    override fun size(cols: Int, rows: Int) {}

    override fun lease(holder: String) {}

    override fun capture(id: String, text: String?, error: String?) {}

    override fun error(text: String) {}
}

class MachineHubSendIsolationTest {

    @Test
    fun `detachViewer does not propagate a send failure from an already-closed machine session`() {
        val hub = MachineHub()
        hub.attachMachine(
            "m1",
            MachineTransport { throw IllegalStateException("session has been closed") },
        )
        val screen = hub.openScreen("m1", listOf("bash"), kind = "test", appletSource = "// src")
        hub.attachViewer(screen.sid, HubViewer("va", NoSink, 80, 24))

        assertDoesNotThrow { hub.detachViewer(screen.sid, "va") }
    }

    @Test
    fun `send swallows IllegalStateException from a closed transport`() {
        val hub = MachineHub()
        hub.attachMachine(
            "m1",
            MachineTransport { throw IllegalStateException("session has been closed") },
        )
        val screen = hub.openScreen("m1", listOf("bash"), kind = "test", appletSource = "// src")

        assertDoesNotThrow {
            hub.attachViewer(screen.sid, HubViewer("va", NoSink, 80, 24))
        }
    }
}
