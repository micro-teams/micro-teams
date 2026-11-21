/*
 *  Description: Integration test for the outcome AgentWakeup reaches on its own clock, with the
 *               back-off shortened to a second (microteams.wakeup.backoff-seconds): a message to a
 *               program that dies on every start. Each wake the back-off holds back is retried
 *               when it ends, with nobody asking again, and once the attempts are spent the
 *               message shows as undelivered ("keeps exiting").
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.api

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

@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = ["microteams.wakeup.backoff-seconds=0,1,1"],
)
@AutoConfigureMockMvc
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(OrderAnnotation::class)
class AgentWakeupBackoffTest
@Autowired
constructor(
    private val mockMvc: MockMvc,
    private val userCreatorService: UserCreatorService,
    private val machineHub: MachineHub,
    private val machineRepository: MachineRepository,
    private val teamMachineRepository: TeamMachineRepository,
) {
    @LocalServerPort private var port: Int = 0

    private lateinit var humanToken: String
    private lateinit var machineId: String
    private lateinit var machineToken: String
    private var teamId: IdType = -1
    private lateinit var machine: WebSocketSession
    private var frames = LinkedBlockingQueue<String>()

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
                        .content("""{"name":"Backoff ${UUID.randomUUID().toString().take(6)}"}"""),
                )
                .andExpect(status().isCreated)
                .andReturn()
        teamId = JSONObject(teamRes.response.contentAsString).getLong("id")
        machineId = "dev" + UUID.randomUUID().toString().replace("-", "").take(12)
        machineToken = "tok-" + UUID.randomUUID().toString().replace("-", "")
        machineRepository.save(
            Machine(machineId = machineId, name = "backoff", token = machineToken),
        )
        teamMachineRepository.save(TeamMachine(machineId = machineId, teamId = teamId))
        connect()
    }

    /** Dial in as a connector, replacing any earlier connection. */
    private fun connect() {
        val inbox = LinkedBlockingQueue<String>()
        val headers = WebSocketHttpHeaders()
        headers.add("X-Microteams-Session", machineToken)
        val container = jakarta.websocket.ContainerProvider.getWebSocketContainer()
        container.defaultMaxTextMessageBufferSize = 4 * 1024 * 1024
        machine =
            StandardWebSocketClient(container)
                .execute(
                    object : TextWebSocketHandler() {
                        override fun handleTextMessage(s: WebSocketSession, m: TextMessage) {
                            inbox.add(m.payload)
                        }
                    },
                    headers,
                    URI("ws://localhost:$port/machine/link"),
                )
                .get(5, TimeUnit.SECONDS)
        frames = inbox
        send("""{"t":"hello","v":2}""")
        await("welcome")
    }

    private fun send(json: String) = machine.sendMessage(TextMessage(json))

    private fun await(type: String, sid: String? = null, timeoutMs: Long = 5000): JSONObject {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            val obj = JSONObject(frames.poll(200, TimeUnit.MILLISECONDS) ?: continue)
            if (obj.optString("t") == type && (sid == null || obj.optString("sid") == sid))
                return obj
        }
        error("no '$type' frame${sid?.let { " for $it" } ?: ""} arrived in time")
    }

    /** Open an agent in a group of its own; returns its screen id and the group's id. */
    private fun openAgent(nickname: String): Pair<String, IdType> {
        val open =
            mockMvc
                .perform(
                    post("/agent")
                        .header("Authorization", "Bearer $humanToken")
                        .contentType("application/json")
                        .content(
                            """{"machineId":"$machineId","teamId":$teamId,"nickname":"$nickname"}""",
                        ),
                )
                .andExpect(status().isCreated)
                .andReturn()
        val body = JSONObject(open.response.contentAsString)
        val sid = body.getString("sid")
        await("session.create", sid)
        val thread =
            mockMvc
                .perform(
                    post("/chat")
                        .header("Authorization", "Bearer $humanToken")
                        .contentType("application/json")
                        .content(
                            """{"title":"$nickname","memberIds":[${body.getLong("agentUserId")}]}""",
                        ),
                )
                .andExpect(status().isCreated)
                .andReturn()
        return sid to JSONObject(thread.response.contentAsString).getLong("id")
    }

    private fun postMessage(threadId: IdType, text: String): Long {
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
        return JSONObject(res.response.contentAsString).getLong("id")
    }

    private fun undeliveredReason(threadId: IdType, messageId: Long, timeoutMs: Long): String {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (true) {
            val res =
                mockMvc
                    .perform(
                        get("/chat/$threadId/messages")
                            .header("Authorization", "Bearer $humanToken"),
                    )
                    .andReturn()
            val all = JSONObject(res.response.contentAsString).getJSONArray("messages")
            val message =
                (0 until all.length())
                    .map { all.getJSONObject(it) }
                    .first { it.getLong("id") == messageId }
            val list = message.optJSONArray("undelivered")
            if (list != null && list.length() > 0) return list.getJSONObject(0).getString("reason")
            check(System.currentTimeMillis() < deadline) { "message $messageId never undelivered" }
            Thread.sleep(100)
        }
    }

    @Test
    @Order(1)
    fun aProgramThatKeepsDyingIsRetriedOnItsOwnAndThenGivenUpOn() {
        val (sid, threadId) = openAgent("Dies")
        val dead = """{"t":"var.push","sid":"$sid","name":"status","value":"dead"}"""
        send(dead)
        Thread.sleep(300)
        val messageId = postMessage(threadId, "are you there")
        // First wake at once; each later one only when its back-off ends, with nothing asking.
        repeat(3) { attempt ->
            val create = await("session.create", sid, timeoutMs = 4000)
            assertTrue(
                create.getJSONArray("command").getString(2).contains("--resume"),
                "wake $attempt",
            )
            // Dies only once the server has it starting, as a program that is started does.
            val deadline = System.currentTimeMillis() + 5000
            while (machineHub.screen(sid)?.state != ScreenState.STARTING) {
                check(System.currentTimeMillis() < deadline) { "wake $attempt never started" }
                Thread.sleep(20)
            }
            send(dead)
        }
        val reason = undeliveredReason(threadId, messageId, 5000)
        assertTrue(reason.contains("keeps exiting"), reason)
    }
}
