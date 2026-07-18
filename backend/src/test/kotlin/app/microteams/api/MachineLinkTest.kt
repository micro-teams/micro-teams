/*
 *  Description: Integration test for the machine control-channel WebSocket (`/agent`) and
 *               the MachineHub. Drives a REAL WebSocket client against a running server
 *               port: an enrolled machine dials in with its `X-Microteams-Session` token and
 *               must receive `welcome`; the server opens a screen and the client must
 *               receive the exact `session.create`; an inbound `rpc.call` (screenReady)
 *               must be answered with `rpc.result`, and a `var.push` must be mirrored into
 *               the screen's variables. A bad token must fail the handshake.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.api

import app.microteams.machine.enrollment.Machine
import app.microteams.machine.enrollment.MachineRepository
import app.microteams.machine.link.MachineHub
import com.fasterxml.jackson.databind.ObjectMapper
import java.net.URI
import java.util.UUID
import java.util.concurrent.ExecutionException
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.web.socket.TextMessage
import org.springframework.web.socket.WebSocketHttpHeaders
import org.springframework.web.socket.WebSocketSession
import org.springframework.web.socket.client.standard.StandardWebSocketClient
import org.springframework.web.socket.handler.TextWebSocketHandler

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class MachineLinkTest
@Autowired
constructor(
    private val machineHub: MachineHub,
    private val machineRepository: MachineRepository,
    private val objectMapper: ObjectMapper,
) {
    @LocalServerPort private var port: Int = 0

    /** Collects every text frame the server pushes, for the test to assert against. */
    private class Collector : TextWebSocketHandler() {
        val frames = LinkedBlockingQueue<String>()
        @Volatile var session: WebSocketSession? = null

        override fun afterConnectionEstablished(session: WebSocketSession) {
            this.session = session
        }

        override fun handleTextMessage(session: WebSocketSession, message: TextMessage) {
            frames.add(message.payload)
        }
    }

    private fun rnd() = UUID.randomUUID().toString().replace("-", "")

    private fun enrollDevice(): Pair<String, String> {
        val machineId = "dev" + rnd().take(12)
        val token = "tok-" + rnd()
        machineRepository.save(Machine(machineId = machineId, name = "test-laptop", token = token))
        return machineId to token
    }

    private fun connect(token: String, collector: Collector): WebSocketSession {
        val headers = WebSocketHttpHeaders()
        headers.add("X-Microteams-Session", token)
        val container = jakarta.websocket.ContainerProvider.getWebSocketContainer()
        container.defaultMaxTextMessageBufferSize = 4 * 1024 * 1024
        return StandardWebSocketClient(container)
            .execute(collector, headers, URI("ws://localhost:$port/machine/link"))
            .get(5, TimeUnit.SECONDS)
    }

    private fun nextFrame(collector: Collector) =
        objectMapper.readTree(
            collector.frames.poll(5, TimeUnit.SECONDS) ?: error("no frame in time")
        )

    @Test
    fun deviceHandshakeWelcomeScreenAndRpcRoundTrip() {
        val (machineId, token) = enrollDevice()
        val collector = Collector()
        val session = connect(token, collector)

        // 1) welcome handshake
        val welcome = nextFrame(collector)
        assertEquals("welcome", welcome["t"].asText())
        assertEquals(1, welcome["v"].asInt())
        assertTrue(machineHub.isOnline(machineId), "machine should be online after handshake")

        // 2) server opens a screen -> client receives the exact session.create
        val screen =
            machineHub.openScreen(
                machineId = machineId,
                command = listOf("bash", "-lc", "echo hi"),
                kind = "test",
                appletSource = "// applet source",
                env = mapOf("MICROTEAMS_API" to "http://127.0.0.1:8080"),
            )
        val create = nextFrame(collector)
        assertEquals("session.create", create["t"].asText())
        assertEquals(screen.sid, create["sid"].asText())
        assertEquals(screen.token, create["screen"].asText())
        assertEquals("// applet source", create["source"].asText())
        assertEquals("bash", create["command"][0].asText())
        assertEquals(120, create["cols"].asInt())
        assertEquals("http://127.0.0.1:8080", create["env"]["MICROTEAMS_API"].asText())

        // 3) inbound rpc.call (screenReady) -> rpc.result with the fn's value
        session.sendMessage(
            TextMessage(
                objectMapper.writeValueAsString(
                    mapOf(
                        "t" to "rpc.call",
                        "sid" to screen.sid,
                        "id" to "c1",
                        "name" to "screenReady",
                        "args" to emptyList<Any>(),
                    )
                )
            )
        )
        val result = nextFrame(collector)
        assertEquals("rpc.result", result["t"].asText())
        assertEquals("c1", result["id"].asText())
        assertEquals(true, result["value"]["ok"].asBoolean())

        // 4) var.push is mirrored into the screen's variables
        session.sendMessage(
            TextMessage(
                objectMapper.writeValueAsString(
                    mapOf(
                        "t" to "var.push",
                        "sid" to screen.sid,
                        "name" to "status",
                        "value" to "busy",
                    )
                )
            )
        )
        var mirrored: Any? = null
        repeat(50) {
            mirrored = machineHub.screen(screen.sid)?.vars?.get("status")
            if (mirrored != null) return@repeat
            Thread.sleep(20)
        }
        assertEquals("busy", mirrored)

        session.close()
    }

    @Test
    fun unknownTokenFailsHandshake() {
        val collector = Collector()
        val ex =
            assertThrows(ExecutionException::class.java) {
                connect("definitely-not-a-real-token", collector)
            }
        assertNotNull(ex.cause)
    }
}
