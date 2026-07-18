/*
 *  Description: End-to-end integration test for the agent chat loop WITHOUT a real Claude:
 *               a fake machine (a real WebSocket client) enrolls and connects; a human opens
 *               an agent on it (creates the agent user + ships a session.create the client
 *               receives); the agent joins a thread; the human posts a message and the client
 *               must receive it as a `say` rpc.call; the "agent" then calls the tool-door
 *               (POST /agent/note, authed by machine+screen token) and its reply must
 *               appear in the thread authored by the agent user. This proves the orchestrator,
 *               the chat->agent event hook, attribution, and the tool-door together.
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
import com.fasterxml.jackson.databind.ObjectMapper
import java.net.URI
import java.util.UUID
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import org.json.JSONObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.rucca.cheese.common.persistent.IdType
import org.rucca.cheese.utils.UserCreatorService
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.*
import org.springframework.web.socket.TextMessage
import org.springframework.web.socket.WebSocketHttpHeaders
import org.springframework.web.socket.WebSocketSession
import org.springframework.web.socket.client.standard.StandardWebSocketClient
import org.springframework.web.socket.handler.TextWebSocketHandler

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class AgentLoopTest
@Autowired
constructor(
    private val mockMvc: MockMvc,
    private val userCreatorService: UserCreatorService,
    private val machineHub: MachineHub,
    private val machineRepository: MachineRepository,
    private val teamMachineRepository: TeamMachineRepository,
    private val objectMapper: ObjectMapper,
) {
    @LocalServerPort private var port: Int = 0

    private lateinit var human: UserCreatorService.CreateUserResponse
    private lateinit var humanToken: String
    private var teamId: IdType = -1
    private lateinit var machineId: String
    private lateinit var machineToken: String

    private class Collector : TextWebSocketHandler() {
        val frames = LinkedBlockingQueue<String>()

        override fun handleTextMessage(session: WebSocketSession, message: TextMessage) {
            frames.add(message.payload)
        }
    }

    @BeforeAll
    fun prepare() {
        human = userCreatorService.createUser()
        humanToken = userCreatorService.login(human.username, human.password)
        teamId = createTeam("Loop Team ${UUID.randomUUID().toString().take(6)}")
        machineId = "dev" + UUID.randomUUID().toString().replace("-", "").take(12)
        machineToken = "tok-" + UUID.randomUUID().toString().replace("-", "")
        machineRepository.save(
            Machine(machineId = machineId, name = "loop-host", token = machineToken)
        )
        teamMachineRepository.save(TeamMachine(machineId = machineId, teamId = teamId))
    }

    private fun createTeam(name: String): IdType {
        val res =
            mockMvc
                .perform(
                    post("/team")
                        .header("Authorization", "Bearer $humanToken")
                        .contentType("application/json")
                        .content("""{"name":"$name"}""")
                )
                .andExpect(status().isCreated)
                .andReturn()
        return JSONObject(res.response.contentAsString).getLong("id")
    }

    private fun connect(collector: Collector): WebSocketSession {
        val headers = WebSocketHttpHeaders()
        headers.add("X-Microteams-Session", machineToken)
        // session.create ships the full applet source (>8 KB), so the client must accept
        // large text frames — raise the container's default buffer.
        val container = jakarta.websocket.ContainerProvider.getWebSocketContainer()
        container.defaultMaxTextMessageBufferSize = 4 * 1024 * 1024
        return StandardWebSocketClient(container)
            .execute(collector, headers, URI("ws://localhost:$port/machine/link"))
            .get(5, TimeUnit.SECONDS)
    }

    private fun awaitFrame(collector: Collector, type: String): JSONObject {
        val deadline = System.currentTimeMillis() + 5000
        while (System.currentTimeMillis() < deadline) {
            val payload = collector.frames.poll(5, TimeUnit.SECONDS) ?: continue
            val obj = JSONObject(payload)
            if (obj.optString("t") == type) return obj
        }
        error("no '$type' frame arrived in time")
    }

    @Test
    fun humanMessageReachesAgentAndAgentReplyLandsInThread() {
        val collector = Collector()
        val session = connect(collector)

        // welcome, then the machine is online
        awaitFrame(collector, "welcome")
        assertTrue(machineHub.isOnline(machineId))

        // human opens an agent on the machine -> agent user + a session.create to the client
        val openRes =
            mockMvc
                .perform(
                    post("/agent")
                        .header("Authorization", "Bearer $humanToken")
                        .contentType("application/json")
                        .content("""{"machineId":"$machineId","teamId":$teamId,"nickname":"Rin"}""")
                )
                .andExpect(status().isCreated)
                .andReturn()
        val agentUserId = JSONObject(openRes.response.contentAsString).getLong("agentUserId")
        val create = awaitFrame(collector, "session.create")
        val screenToken = create.getString("screen")
        assertTrue(create.getJSONArray("command").getString(0) == "bash")

        // form the group: a thread with the human (owner) and the agent as a member
        val threadRes =
            mockMvc
                .perform(
                    post("/chat")
                        .header("Authorization", "Bearer $humanToken")
                        .contentType("application/json")
                        .content("""{"title":"standup","memberIds":[$agentUserId]}""")
                )
                .andExpect(status().isCreated)
                .andReturn()
        val threadId = JSONObject(threadRes.response.contentAsString).getLong("id")

        // human posts -> the agent's screen must receive it as a `say` rpc.call
        mockMvc
            .perform(
                post("/chat/$threadId/messages")
                    .header("Authorization", "Bearer $humanToken")
                    .contentType("application/json")
                    .content("""{"content":"hey agent, are you there?"}""")
            )
            .andExpect(status().isCreated)
        val say = awaitFrame(collector, "rpc.call")
        assertEquals("say", say.getString("name"))
        assertTrue(
            say.getJSONArray("args").getString(0).contains("hey agent, are you there?"),
            "the say prompt should carry the human's message",
        )

        // the "agent" replies through the tool door (machine + screen token attribution)
        mockMvc
            .perform(
                post("/agent/note")
                    .header("Authorization", "Bearer $machineToken")
                    .header("X-Microteams-Screen", screenToken)
                    .contentType("application/json")
                    .content("""{"text":"yes! reporting in.","thread_id":$threadId}""")
            )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.senderId").value(agentUserId))
            .andExpect(jsonPath("$.content").value("yes! reporting in."))

        // the reply is now in the thread, authored by the agent
        mockMvc
            .perform(get("/chat/$threadId/messages").header("Authorization", "Bearer $humanToken"))
            .andExpect(status().isOk)
            .andExpect(
                jsonPath("$.messages[?(@.senderId == $agentUserId)].content")
                    .value(org.hamcrest.Matchers.hasItem("yes! reporting in."))
            )

        session.close()
    }

    /**
     * The spec `microteams api` builds its commands from must advertise the path the server
     * actually serves. Nothing else checks this: the loop test above posts to the tool-door
     * directly, so a stale path here would compile, pass every test, and only surface as a live
     * agent whose every reply 404s — which is exactly what happened when the tool-door moved to
     * /agent/note.
     */
    @Test
    fun advertisedToolDoorPathIsTheOneThatWorks() {
        val spec =
            mockMvc
                .perform(get("/openapi.json"))
                .andExpect(status().isOk)
                .andReturn()
                .response
                .contentAsString
        val advertised: String =
            JSONObject(spec).getJSONObject("paths").keys().asSequence().single().toString()
        assertEquals("/agent/note", advertised)
        // and it is a real route: reachable, refusing us only for want of credentials
        mockMvc
            .perform(post(advertised).contentType("application/json").content("""{"text":"x"}"""))
            .andExpect(status().isUnauthorized)
    }

    /**
     * 401, not 403: the machine token alone proves which *machine* is calling, never which agent.
     * Without the per-screen token the caller has not finished authenticating, so there is nobody
     * to authorize — the machine+screen pair together are the agent's credentials.
     */
    @Test
    fun postNoteWithoutScreenTokenIsUnauthenticated() {
        mockMvc
            .perform(
                post("/agent/note")
                    .header("Authorization", "Bearer $machineToken")
                    .contentType("application/json")
                    .content("""{"text":"nope","thread_id":1}""")
            )
            .andExpect(status().isUnauthorized)
    }
}
