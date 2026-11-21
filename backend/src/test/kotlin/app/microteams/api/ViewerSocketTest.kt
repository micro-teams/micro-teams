/*
 *  Description: Integration test for the live-screen viewer WebSocket against a fake machine:
 *               the contract a browser sees.
 *
 *               - A viewer that says its size is subscribed at once under its own viewer id at that
 *                 size; what the machine says for it arrives in order, the size before the data.
 *               - Lease state is told as free / self / driver / other (with the other person's
 *                 nickname), and the same holder told twice is a refusal.
 *               - The first frame lists the commands the screen offers (none for a screen of no
 *                 agent), and a command not listed is refused.
 *               - A terminal reply goes to the machine as input that bypasses the lease.
 *               - A lease state is a refusal only when it answers this viewer's input or take.
 *               - Capture is answered.
 *               - A viewer that sends no size is subscribed at 120x32 and the server
 *                 acknowledges the bytes it writes to it.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.api

import app.microteams.machine.enrollment.Machine
import app.microteams.machine.enrollment.MachineRepository
import app.microteams.machine.link.MachineHub
import app.microteams.team.machine.TeamMachine
import app.microteams.team.machine.TeamMachineRepository
import java.net.URI
import java.util.Base64
import java.util.UUID
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import org.json.JSONObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.MethodOrderer.OrderAnnotation
import org.junit.jupiter.api.Order
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.junit.jupiter.api.TestMethodOrder
import org.rucca.cheese.utils.UserCreatorService
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import org.springframework.web.socket.BinaryMessage
import org.springframework.web.socket.TextMessage
import org.springframework.web.socket.WebSocketHttpHeaders
import org.springframework.web.socket.WebSocketSession
import org.springframework.web.socket.client.standard.StandardWebSocketClient
import org.springframework.web.socket.handler.AbstractWebSocketHandler
import org.springframework.web.socket.handler.TextWebSocketHandler

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(OrderAnnotation::class)
class ViewerSocketTest
@Autowired
constructor(
    private val mockMvc: MockMvc,
    private val userCreatorService: UserCreatorService,
    private val machineHub: MachineHub,
    private val machineRepository: MachineRepository,
    private val teamMachineRepository: TeamMachineRepository,
) {
    @LocalServerPort private var port: Int = 0

    private lateinit var aliceToken: String
    private lateinit var aliceNickname: String
    private lateinit var machine: WebSocketSession
    private val fromServer = LinkedBlockingQueue<String>()
    private lateinit var sid: String

    /** One browser: text frames as JSON, binary frames as "bin:<text>". */
    private class Browser : AbstractWebSocketHandler() {
        val frames = LinkedBlockingQueue<String>()

        override fun handleTextMessage(session: WebSocketSession, message: TextMessage) {
            frames.add(message.payload)
        }

        override fun handleBinaryMessage(session: WebSocketSession, message: BinaryMessage) {
            val buf = message.payload
            frames.add("bin:" + String(ByteArray(buf.remaining()).also { buf.get(it) }))
        }

        fun next(): String = frames.poll(5, TimeUnit.SECONDS) ?: error("no frame for the browser")

        fun nextJson(): JSONObject = JSONObject(next())
    }

    @BeforeAll
    fun prepare() {
        val alice = userCreatorService.createUser()
        aliceToken = userCreatorService.login(alice.username, alice.password)
        aliceNickname = alice.nickname
        val teamRes =
            mockMvc
                .perform(
                    post("/team")
                        .header("Authorization", "Bearer $aliceToken")
                        .contentType("application/json")
                        .content("""{"name":"Viewers ${UUID.randomUUID().toString().take(6)}"}"""),
                )
                .andExpect(status().isCreated)
                .andReturn()
        val teamId = JSONObject(teamRes.response.contentAsString).getLong("id")
        val machineId = "dev" + UUID.randomUUID().toString().replace("-", "").take(12)
        val machineToken = "tok-" + UUID.randomUUID().toString().replace("-", "")
        machineRepository.save(
            Machine(machineId = machineId, name = "viewers", token = machineToken),
        )
        teamMachineRepository.save(TeamMachine(machineId = machineId, teamId = teamId))

        val headers = WebSocketHttpHeaders()
        headers.add("X-Microteams-Session", machineToken)
        val container = jakarta.websocket.ContainerProvider.getWebSocketContainer()
        container.defaultMaxTextMessageBufferSize = 4 * 1024 * 1024
        machine =
            StandardWebSocketClient(container)
                .execute(
                    object : TextWebSocketHandler() {
                        override fun handleTextMessage(s: WebSocketSession, m: TextMessage) {
                            fromServer.add(m.payload)
                        }
                    },
                    headers,
                    URI("ws://localhost:$port/machine/link"),
                )
                .get(5, TimeUnit.SECONDS)
        machine.sendMessage(TextMessage("""{"t":"hello","v":2}"""))
        await("welcome")

        // A screen nobody's agent owns: the viewer contract is the machine layer's, not the
        // agent's.
        sid = machineHub.openScreen(machineId, listOf("bash"), kind = "test").sid
        await("session.create")
    }

    private fun await(type: String, match: (JSONObject) -> Boolean = { true }): JSONObject {
        val deadline = System.currentTimeMillis() + 5000
        while (System.currentTimeMillis() < deadline) {
            val obj = JSONObject(fromServer.poll(200, TimeUnit.MILLISECONDS) ?: continue)
            if (obj.optString("t") == type && match(obj)) return obj
        }
        error("the machine got no '$type' in time")
    }

    private fun fromMachine(json: String) = machine.sendMessage(TextMessage(json))

    private fun b64(s: String) = Base64.getEncoder().encodeToString(s.toByteArray())

    private fun open(token: String, size: String?, browser: Browser): WebSocketSession {
        val query = "token=$token" + (size ?: "")
        return StandardWebSocketClient()
            .execute(
                browser,
                WebSocketHttpHeaders(),
                URI("ws://localhost:$port/machine/screen/$sid?$query"),
            )
            .get(5, TimeUnit.SECONDS)
            .also {
                val first = browser.nextJson()
                assertEquals("commands", first.getString("type"), "the commands come first")
                assertEquals(
                    0,
                    first.getJSONArray("names").length(),
                    "a screen of no agent offers none",
                )
            }
    }

    @Test
    @Order(1)
    fun aViewerIsSubscribedAtItsSizeAndToldThingsInOrder() {
        val browser = Browser()
        val socket = open(aliceToken, "&cols=100&rows=30", browser)
        val sub = await("screen.subscribe")
        val viewer = sub.getString("viewer")
        assertTrue(viewer.matches(Regex("v[0-9a-f]{8}")), viewer)
        assertEquals(100, sub.getInt("cols"))
        assertEquals(30, sub.getInt("rows"))

        fromMachine("""{"t":"screen.size","sid":"$sid","viewer":"$viewer","cols":100,"rows":30}""")
        fromMachine(
            """{"t":"screen.data","sid":"$sid","viewer":"$viewer","data":"${b64("hello")}"}""",
        )
        fromMachine(
            """{"t":"screen.data","sid":"$sid","viewer":"vsomebody","data":"${b64("not yours")}"}""",
        )
        fromMachine("""{"t":"screen.lease.state","sid":"$sid","viewer":"$viewer"}""")
        val size = browser.nextJson()
        assertEquals("size", size.getString("type"))
        assertEquals(100, size.getInt("cols"))
        assertEquals("bin:hello", browser.next())
        val lease = browser.nextJson()
        assertEquals("free", lease.getString("holder"))
        assertFalse(lease.getBoolean("refused"))

        // Input is the viewer's, carried under its id; acks and leases likewise.
        socket.sendMessage(BinaryMessage("k".toByteArray()))
        assertEquals(b64("k"), await("screen.input").getString("data"))
        socket.sendMessage(TextMessage("""{"type":"ack","n":5}"""))
        assertEquals(5, await("screen.ack") { it.getString("viewer") == viewer }.getInt("n"))
        socket.sendMessage(TextMessage("""{"type":"lease","op":"take"}"""))
        assertEquals("take", await("screen.lease").getString("op"))
        fromMachine(
            """{"t":"screen.lease.state","sid":"$sid","viewer":"$viewer","holder":"$viewer"}""",
        )
        assertEquals("self", browser.nextJson().getString("holder"))
        fromMachine(
            """{"t":"screen.lease.state","sid":"$sid","viewer":"$viewer","holder":"driver"}""",
        )
        assertEquals("driver", browser.nextJson().getString("holder"))
        // The same holder again, answering nothing this viewer did (a resubscribe's repeat).
        fromMachine(
            """{"t":"screen.lease.state","sid":"$sid","viewer":"$viewer","holder":"driver"}""",
        )
        assertFalse(browser.nextJson().getBoolean("refused"), "a repeat on its own is no refusal")
        // A take the connector answers with the holder unchanged is.
        socket.sendMessage(TextMessage("""{"type":"lease","op":"take"}"""))
        await("screen.lease")
        fromMachine(
            """{"t":"screen.lease.state","sid":"$sid","viewer":"$viewer","holder":"driver"}""",
        )
        assertTrue(browser.nextJson().getBoolean("refused"), "an unchanged answer to a take")
        // So is the answer to input.
        socket.sendMessage(BinaryMessage("z".toByteArray()))
        await("screen.input")
        fromMachine(
            """{"t":"screen.lease.state","sid":"$sid","viewer":"$viewer","holder":"driver"}""",
        )
        assertTrue(browser.nextJson().getBoolean("refused"), "an unchanged answer to input")

        // The terminal's answer to a query is input that needs no lease.
        socket.sendMessage(TextMessage("""{"type":"reply","data":"${b64("\u001b[?1;2c")}"}"""))
        val reply = await("screen.input") { it.optString("op") == "reply" }
        assertEquals(viewer, reply.getString("viewer"))

        socket.sendMessage(TextMessage("""{"type":"capture","id":"c1"}"""))
        assertEquals("c1", await("screen.capture").getString("id"))
        fromMachine(
            """{"t":"screen.capture.result","sid":"$sid","viewer":"$viewer","id":"c1","data":"${b64("line")}"}""",
        )
        val capture = browser.nextJson()
        assertEquals("capture", capture.getString("type"))
        assertEquals("line", capture.getString("text"))

        // Nothing is listed for this screen, so nothing may be called on it.
        socket.sendMessage(TextMessage("""{"type":"command","id":"x2","name":"compact"}"""))
        val refusedCommand = browser.nextJson()
        assertEquals("x2", refusedCommand.getString("id"))
        assertTrue(refusedCommand.getString("error").contains("offers no command"))

        fromMachine(
            """{"t":"screen.error","sid":"$sid","viewer":"$viewer","error":"client ended"}""",
        )
        assertEquals("client ended", browser.nextJson().getString("error"))

        socket.close()
        assertEquals(viewer, await("screen.unsubscribe").getString("viewer"))
    }

    @Test
    @Order(2)
    fun anotherViewerHoldingTheLeaseIsNamed() {
        // Two tabs of one person are two viewers; the holder is named by its person's nickname.
        val a = Browser()
        val sa = open(aliceToken, "&cols=80&rows=24", a)
        val va = await("screen.subscribe").getString("viewer")
        val b = Browser()
        val sb = open(aliceToken, "&cols=80&rows=24", b)
        val vb = await("screen.subscribe").getString("viewer")
        fromMachine("""{"t":"screen.lease.state","sid":"$sid","viewer":"$va","holder":"$vb"}""")
        val lease = a.nextJson()
        assertEquals("other", lease.getString("holder"))
        assertEquals(aliceNickname, lease.getString("name"), "the other viewer's person is named")
        sa.close()
        sb.close()
    }

    @Test
    @Order(3)
    fun aSizelessViewerGetsTheDefaultSizeAndIsAcknowledgedByTheServer() {
        val browser = Browser()
        val socket = open(aliceToken, null, browser)
        val sub = await("screen.subscribe")
        assertEquals(120, sub.getInt("cols"))
        assertEquals(32, sub.getInt("rows"))
        val viewer = sub.getString("viewer")
        fromMachine(
            """{"t":"screen.data","sid":"$sid","viewer":"$viewer","data":"${b64("abc")}"}""",
        )
        assertEquals("bin:abc", browser.next())
        assertEquals(3, await("screen.ack") { it.getString("viewer") == viewer }.getInt("n"))
        socket.close()
    }
}
