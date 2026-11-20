/*
 *  Description: Integration test for delivering a chat message to an agent's program, and for the
 *               sender seeing when that definitely failed.
 *
 *               A fake machine (a real WebSocket client) says hello, a human opens an agent on it
 *               and messages it in a group. Each message arrives as `say(text, "m<messageId>")`,
 *               and the fake answers as an applet would:
 *                 - accepted (rpc.result) and then `sayResult {ok:false}` -> the message carries
 *                   `undelivered` for the agent, over the API;
 *                 - `sayResult {ok:true}` -> it does not;
 *                 - an rpc error -> undelivered;
 *                 - never answered, and the machine connects again -> said again on the new
 *                   connection;
 *                 - accepted, and the machine connects again -> not said again (the applet still
 *                   holds it), until an applet announces itself after the re-adopt;
 *                 - a protocol 1 machine, which never calls sayResult: the accepted rpc.result is
 *                   delivery, so a reconnect does not say it again — but `false` is a failure;
 *                 - what a server still owed when it stopped is marked undelivered when the next
 *                   one starts (reportLostOnRestart, which startup runs).
 *
 *               It also opens the agent's live screen: the commands frame lists the claude
 *               driver's viewer commands, and a listed one is called on the applet.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.api

import app.microteams.agent.AgentWakeup
import app.microteams.machine.enrollment.Machine
import app.microteams.machine.enrollment.MachineRepository
import app.microteams.machine.link.MachineHub
import app.microteams.machine.link.ScreenState
import app.microteams.team.machine.TeamMachine
import app.microteams.team.machine.TeamMachineRepository
import java.net.URI
import java.util.UUID
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import org.json.JSONObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.MethodOrderer.OrderAnnotation
import org.junit.jupiter.api.Order
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.junit.jupiter.api.TestMethodOrder
import org.rucca.cheese.common.persistent.IdType
import org.rucca.cheese.utils.UserCreatorService
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import org.springframework.web.socket.TextMessage
import org.springframework.web.socket.WebSocketHttpHeaders
import org.springframework.web.socket.WebSocketSession
import org.springframework.web.socket.client.standard.StandardWebSocketClient
import org.springframework.web.socket.handler.TextWebSocketHandler

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(OrderAnnotation::class)
class AgentDeliveryTest
@Autowired
constructor(
    private val mockMvc: MockMvc,
    private val userCreatorService: UserCreatorService,
    private val machineHub: MachineHub,
    private val machineRepository: MachineRepository,
    private val teamMachineRepository: TeamMachineRepository,
    private val agentWakeup: AgentWakeup,
) {
    @LocalServerPort private var port: Int = 0

    private lateinit var humanToken: String
    private lateinit var machineId: String
    private lateinit var machineToken: String
    private lateinit var machine: WebSocketSession
    private lateinit var collector: Collector
    private lateinit var sid: String
    private var agentUserId: IdType = -1
    private var threadId: IdType = -1

    private class Collector : TextWebSocketHandler() {
        val frames = LinkedBlockingQueue<String>()

        override fun handleTextMessage(session: WebSocketSession, message: TextMessage) {
            frames.add(message.payload)
        }
    }

    @BeforeAll
    fun prepare() {
        val human = userCreatorService.createUser()
        humanToken = userCreatorService.login(human.username, human.password)
        val teamRes =
            mockMvc
                .perform(
                    post("/team")
                        .header("Authorization", "Bearer $humanToken")
                        .contentType("application/json")
                        .content("""{"name":"Delivery ${UUID.randomUUID().toString().take(6)}"}"""),
                )
                .andExpect(status().isCreated)
                .andReturn()
        val teamId = JSONObject(teamRes.response.contentAsString).getLong("id")
        machineId = "dev" + UUID.randomUUID().toString().replace("-", "").take(12)
        machineToken = "tok-" + UUID.randomUUID().toString().replace("-", "")
        machineRepository.save(
            Machine(machineId = machineId, name = "delivery", token = machineToken),
        )
        teamMachineRepository.save(TeamMachine(machineId = machineId, teamId = teamId))
        connect(2)

        val openRes =
            mockMvc
                .perform(
                    post("/agent")
                        .header("Authorization", "Bearer $humanToken")
                        .contentType("application/json")
                        .content(
                            """{"machineId":"$machineId","teamId":$teamId,"nickname":"Dee"}""",
                        ),
                )
                .andExpect(status().isCreated)
                .andReturn()
        agentUserId = JSONObject(openRes.response.contentAsString).getLong("agentUserId")
        sid = JSONObject(openRes.response.contentAsString).getString("sid")
        await("session.create")
        ready()

        val threadRes =
            mockMvc
                .perform(
                    post("/chat")
                        .header("Authorization", "Bearer $humanToken")
                        .contentType("application/json")
                        .content("""{"title":"delivery","memberIds":[$agentUserId]}"""),
                )
                .andExpect(status().isCreated)
                .andReturn()
        threadId = JSONObject(threadRes.response.contentAsString).getLong("id")
    }

    /** Dial in as a connector speaking protocol [v], replacing any earlier connection. */
    private fun connect(v: Int) {
        collector = Collector()
        val headers = WebSocketHttpHeaders()
        headers.add("X-Microteams-Session", machineToken)
        val container = jakarta.websocket.ContainerProvider.getWebSocketContainer()
        container.defaultMaxTextMessageBufferSize = 4 * 1024 * 1024
        machine =
            StandardWebSocketClient(container)
                .execute(collector, headers, URI("ws://localhost:$port/machine/link"))
                .get(5, TimeUnit.SECONDS)
        send("""{"t":"hello","v":$v}""")
        await("welcome")
    }

    private fun send(json: String) = machine.sendMessage(TextMessage(json))

    /** What an applet says when it has loaded. */
    private fun ready() {
        send(
            """{"t":"rpc.call","sid":"$sid","id":"r${UUID.randomUUID()}","name":"screenReady","args":[{}]}""",
        )
        val deadline = System.currentTimeMillis() + 5000
        while (machineHub.screen(sid)?.state != ScreenState.LIVE) {
            check(System.currentTimeMillis() < deadline) { "the screen never went live" }
            Thread.sleep(50)
        }
    }

    private fun await(type: String, name: String? = null, timeoutMs: Long = 5000): JSONObject =
        poll(type, name, timeoutMs) ?: error("no '$type' ${name ?: ""} frame arrived in time")

    private fun poll(type: String, name: String?, timeoutMs: Long): JSONObject? {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            val payload = collector.frames.poll(200, TimeUnit.MILLISECONDS) ?: continue
            val obj = JSONObject(payload)
            if (obj.optString("t") == type && (name == null || obj.optString("name") == name))
                return obj
        }
        return null
    }

    /** Post [text] to the group and return the `say` call the machine receives for it. */
    private fun postAndAwaitSay(text: String): Pair<Long, JSONObject> {
        val res =
            mockMvc
                .perform(
                    post("/chat/$threadId/messages")
                        .header("Authorization", "Bearer $humanToken")
                        .contentType("application/json")
                        .content("""{"content":"$text"}"""),
                )
                .andExpect(status().isCreated)
                .andReturn()
        val messageId = JSONObject(res.response.contentAsString).getLong("id")
        val say = await("rpc.call", "say")
        assertTrue(say.getJSONArray("args").getString(0).contains(text))
        assertEquals(
            "m$messageId",
            say.getJSONArray("args").getString(1),
            "a chat message says under its id",
        )
        return messageId to say
    }

    private fun accept(say: JSONObject) =
        send("""{"t":"rpc.result","sid":"$sid","id":"${say.getString("id")}","value":"queued"}""")

    /** Report [id]'s outcome as an applet does, and wait until the server has taken it. */
    private fun sayResult(id: String, ok: Boolean, error: String = "") {
        val call = "c${UUID.randomUUID()}"
        send(
            """{"t":"rpc.call","sid":"$sid","id":"$call","name":"sayResult",""" +
                """"args":[{"id":"$id","ok":$ok,"error":"$error"}]}""",
        )
        val deadline = System.currentTimeMillis() + 5000
        while (poll("rpc.result", null, 200)?.optString("id") != call) {
            check(System.currentTimeMillis() < deadline) { "sayResult $call was never answered" }
        }
    }

    /** The message as the API shows it to its sender. */
    private fun message(messageId: Long): JSONObject {
        val res =
            mockMvc
                .perform(
                    get("/chat/$threadId/messages").header("Authorization", "Bearer $humanToken"),
                )
                .andExpect(status().isOk)
                .andReturn()
        val all = JSONObject(res.response.contentAsString).getJSONArray("messages")
        return (0 until all.length())
            .map { all.getJSONObject(it) }
            .first { it.getLong("id") == messageId }
    }

    private fun awaitUndelivered(messageId: Long): JSONObject {
        val deadline = System.currentTimeMillis() + 5000
        while (true) {
            val list = message(messageId).optJSONArray("undelivered")
            if (list != null && list.length() > 0) return list.getJSONObject(0)
            check(System.currentTimeMillis() < deadline) {
                "message $messageId never showed as undelivered"
            }
            Thread.sleep(100)
        }
    }

    private fun stillDelivered(messageId: Long) {
        Thread.sleep(800)
        val list = message(messageId).optJSONArray("undelivered")
        assertTrue(
            list == null || list.length() == 0,
            "message $messageId must not show as undelivered",
        )
    }

    @Test
    @Order(1)
    fun aSayResultThatFailedShowsTheMessageAsUndelivered() {
        val (messageId, say) = postAndAwaitSay("first")
        accept(say)
        sayResult("m$messageId", ok = false, error = "the Enter could not be written")
        val entry = awaitUndelivered(messageId)
        assertEquals(agentUserId, entry.getLong("userId"))
        assertTrue(
            entry.getString("reason").contains("the Enter could not be written"),
            entry.toString(),
        )
    }

    @Test
    @Order(2)
    fun aSayResultThatSucceededDoesNot() {
        val (messageId, say) = postAndAwaitSay("second")
        accept(say)
        sayResult("m$messageId", ok = true)
        stillDelivered(messageId)
    }

    @Test
    @Order(3)
    fun anAppletErrorIsADefiniteFailure() {
        val (messageId, say) = postAndAwaitSay("third")
        send(
            """{"t":"rpc.result","sid":"$sid","id":"${say.getString("id")}","error":"the applet exposes no function \"say\""}""",
        )
        assertTrue(awaitUndelivered(messageId).getString("reason").contains("exposes no function"))
    }

    @Test
    @Order(4)
    fun aSayNeverAcceptedIsSaidAgainOnTheNextConnection() {
        val (messageId, _) = postAndAwaitSay("fourth")
        connect(2)
        val again = await("rpc.call", "say")
        assertEquals("m$messageId", again.getJSONArray("args").getString(1))
        accept(again)
        sayResult("m$messageId", ok = true)
        stillDelivered(messageId)
    }

    @Test
    @Order(5)
    fun anAcceptedSayWaitsForTheAppletUnlessTheAppletRestarted() {
        val (messageId, say) = postAndAwaitSay("fifth")
        accept(say)
        Thread.sleep(300)
        connect(2) // the re-adopt sends a new session.create
        await("session.create")
        assertEquals(null, poll("rpc.call", "say", 1500), "a surviving applet still holds it")
        ready() // ...but this one loaded afresh, so it holds nothing sent before
        val again = await("rpc.call", "say")
        assertEquals("m$messageId", again.getJSONArray("args").getString(1))
        accept(again)
        sayResult("m$messageId", ok = true)
    }

    @Test
    @Order(6)
    fun aProtocol1AppletsAcceptanceIsDelivery() {
        connect(1)
        await("session.create")
        ready()
        val (messageId, say) = postAndAwaitSay("sixth")
        send("""{"t":"rpc.result","sid":"$sid","id":"${say.getString("id")}","value":true}""")
        Thread.sleep(300)
        connect(1)
        await("session.create")
        assertEquals(null, poll("rpc.call", "say", 1500), "delivered, so never said again")
        stillDelivered(messageId)
    }

    @Test
    @Order(7)
    fun aProtocol1AppletAnsweringFalseDidNotTakeIt() {
        val (messageId, say) = postAndAwaitSay("seventh")
        send("""{"t":"rpc.result","sid":"$sid","id":"${say.getString("id")}","value":false}""")
        assertTrue(awaitUndelivered(messageId).getString("reason").contains("could not take it"))
    }

    @Test
    @Order(8)
    fun theLiveScreenOffersTheDriversCommands() {
        val frames = LinkedBlockingQueue<String>()
        val viewer =
            StandardWebSocketClient()
                .execute(
                    object : TextWebSocketHandler() {
                        override fun handleTextMessage(s: WebSocketSession, m: TextMessage) {
                            frames.add(m.payload)
                        }
                    },
                    WebSocketHttpHeaders(),
                    URI(
                        "ws://localhost:$port/machine/screen/$sid?token=$humanToken&cols=80&rows=24",
                    ),
                )
                .get(5, TimeUnit.SECONDS)
        // On this protocol 1 machine the size echo comes with the subscribe; the commands follow.
        var commands = JSONObject(frames.poll(5, TimeUnit.SECONDS) ?: error("no frame"))
        if (commands.getString("type") == "size")
            commands = JSONObject(frames.poll(5, TimeUnit.SECONDS) ?: error("no commands frame"))
        assertEquals("commands", commands.getString("type"))
        val names = commands.getJSONArray("names")
        assertEquals(
            listOf("usage", "compact"),
            (0 until names.length()).map { names.getString(it) },
        )
        viewer.sendMessage(TextMessage("""{"type":"command","id":"u1","name":"usage"}"""))
        await("rpc.call", "usage")
        viewer.close()
    }

    @Test
    @Order(9)
    fun whatAServerStillOwedWhenItStoppedIsUndelivered() {
        val (messageId, _) = postAndAwaitSay("ninth")
        // What the next server's startup does with the rows this one left.
        agentWakeup.reportLostOnRestart()
        assertTrue(awaitUndelivered(messageId).getString("reason").contains("server restarted"))
    }
}
