/*
 *  Description: Regression test for T-092: a viewer's connection closing must not crash on a
 *               machine control-link session that is already gone. HubMachine.send() had no
 *               try/catch around the transport write, so an IllegalStateException from a
 *               closed WebSocket session (the exact shape Tomcat throws for a write against a
 *               closed session — this is what production hit right after a backend restart, when
 *               a burst of reconnects and the detaches/resubscribes they trigger land in the same
 *               narrow window) propagated straight out of detachViewer and out of whatever caller
 *               triggered it.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.machine.link

import org.junit.jupiter.api.Assertions.assertDoesNotThrow
import org.junit.jupiter.api.Test

class MachineHubSendIsolationTest {

    @Test
    fun `detachViewer does not propagate a send failure from an already-closed machine session`() {
        val hub = MachineHub()
        hub.attachMachine(
            "m1",
            MachineTransport { throw IllegalStateException("session has been closed") },
        )
        val screen = hub.openScreen("m1", listOf("bash"), kind = "test", appletSource = "// src")
        val viewer = ViewerTransport {}
        hub.attachViewer("m1", screen.sid, viewer)

        assertDoesNotThrow { hub.detachViewer("m1", screen.sid, viewer) }
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
            hub.attachViewer("m1", screen.sid, ViewerTransport {})
        }
    }
}
