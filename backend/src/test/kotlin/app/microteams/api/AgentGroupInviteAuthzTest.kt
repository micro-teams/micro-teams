/*
 *  Description: Authorization regression test for pulling an agent into a group. Only a member of an
 *               agent's team may add that agent to a thread, via EITHER entry point — the initial
 *               memberIds of POST /chat, or POST /chat/{id}/members. Before the fix, create-chat was
 *               open to anyone (so any user could name any agent's userId in a new thread's
 *               memberIds) and add-chat-member only checked thread-admin (never who was added), so an
 *               outsider could pull another team's agent into a group and command it. Adding humans
 *               stays unrestricted — the rule guards agents only.
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
import java.util.UUID
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import org.json.JSONObject
import org.junit.jupiter.api.AfterAll
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
class AgentGroupInviteAuthzTest
@Autowired
constructor(
    private val mockMvc: MockMvc,
    private val userCreatorService: UserCreatorService,
    private val machineHub: MachineHub,
    private val machineRepository: MachineRepository,
    private val teamMachineRepository: TeamMachineRepository,
) {
    @LocalServerPort private var port: Int = 0

    private lateinit var owner:
        UserCreatorService.CreateUserResponse // a member of the agent's team
    private lateinit var ownerToken: String
    private lateinit var outsider: UserCreatorService.CreateUserResponse // NOT in the agent's team
    private lateinit var outsiderToken: String
    private var teamId: IdType = -1
    private lateinit var machineId: String
    private lateinit var machineToken: String
    private var agentUserId: IdType = -1
    private lateinit var machineSession: WebSocketSession

    private class Collector : TextWebSocketHandler() {
        val frames = LinkedBlockingQueue<String>()

        override fun handleTextMessage(session: WebSocketSession, message: TextMessage) {
            frames.add(message.payload)
        }
    }

    @BeforeAll
    fun prepare() {
        owner = userCreatorService.createUser()
        ownerToken = userCreatorService.login(owner.username, owner.password)
        outsider = userCreatorService.createUser()
        outsiderToken = userCreatorService.login(outsider.username, outsider.password)

        teamId = createTeam("Authz Team ${UUID.randomUUID().toString().take(6)}", ownerToken)
        machineId = "dev" + UUID.randomUUID().toString().replace("-", "").take(12)
        machineToken = "tok-" + UUID.randomUUID().toString().replace("-", "")
        machineRepository.save(
            Machine(machineId = machineId, name = "authz-host", token = machineToken)
        )
        teamMachineRepository.save(TeamMachine(machineId = machineId, teamId = teamId))

        // A fake machine connects and the owner opens an agent on it, so a real agent user exists
        // with a screen row carrying teamId — which is what mayPullInUser checks. Awaiting
        // session.create ensures the open flow has fully landed before the tests run.
        val collector = Collector()
        machineSession = connect(collector)
        awaitFrame(collector, "welcome")
        assertTrue(machineHub.isOnline(machineId))
        val openRes =
            mockMvc
                .perform(
                    post("/agent")
                        .header("Authorization", "Bearer $ownerToken")
                        .contentType("application/json")
                        .content("""{"machineId":"$machineId","teamId":$teamId,"nickname":"Rin"}""")
                )
                .andExpect(status().isCreated)
                .andReturn()
        agentUserId = JSONObject(openRes.response.contentAsString).getLong("agentUserId")
        awaitFrame(collector, "session.create")
    }

    @AfterAll
    fun teardown() {
        if (::machineSession.isInitialized) machineSession.close()
    }

    // ---- the two exploit paths, now closed --------------------------------

    /** POST /chat with a foreign agent in memberIds — the worst path, open to anyone before. */
    @Test
    fun outsiderCannotCreateGroupContainingAForeignAgent() {
        mockMvc
            .perform(
                post("/chat")
                    .header("Authorization", "Bearer $outsiderToken")
                    .contentType("application/json")
                    .content("""{"title":"pwn","memberIds":[$agentUserId]}""")
            )
            .andExpect(status().isForbidden)
    }

    /**
     * POST /chat/{id}/members: the outsider is admin of their own thread, but still cannot add it.
     */
    @Test
    fun outsiderCannotAddAForeignAgentToTheirOwnThread() {
        val threadId = createThread("""{"title":"mine"}""", outsiderToken)
        mockMvc
            .perform(
                post("/chat/$threadId/members")
                    .header("Authorization", "Bearer $outsiderToken")
                    .contentType("application/json")
                    .content("""{"userId":$agentUserId}""")
            )
            .andExpect(status().isForbidden)
    }

    // ---- the legitimate paths still work ----------------------------------

    /** A member of the agent's team may add it, exactly as before. */
    @Test
    fun teamMemberCanAddTheirTeamsAgent() {
        val threadId = createThread("""{"title":"standup"}""", ownerToken)
        mockMvc
            .perform(
                post("/chat/$threadId/members")
                    .header("Authorization", "Bearer $ownerToken")
                    .contentType("application/json")
                    .content("""{"userId":$agentUserId}""")
            )
            .andExpect(status().isNoContent)
    }

    /** Adding humans is unaffected: the new rule guards agents only. */
    @Test
    fun addingAHumanIsUnaffected() {
        val threadId =
            createThread("""{"title":"humans","memberIds":[${owner.userId}]}""", outsiderToken)
        mockMvc
            .perform(
                post("/chat/$threadId/members")
                    .header("Authorization", "Bearer $outsiderToken")
                    .contentType("application/json")
                    .content("""{"userId":${owner.userId}}""")
            )
            .andExpect(status().isNoContent)
    }

    // ---- helpers ----------------------------------------------------------

    private fun createTeam(name: String, token: String): IdType {
        val res =
            mockMvc
                .perform(
                    post("/team")
                        .header("Authorization", "Bearer $token")
                        .contentType("application/json")
                        .content("""{"name":"$name"}""")
                )
                .andExpect(status().isCreated)
                .andReturn()
        return JSONObject(res.response.contentAsString).getLong("id")
    }

    private fun createThread(body: String, token: String): IdType {
        val res =
            mockMvc
                .perform(
                    post("/chat")
                        .header("Authorization", "Bearer $token")
                        .contentType("application/json")
                        .content(body)
                )
                .andExpect(status().isCreated)
                .andReturn()
        return JSONObject(res.response.contentAsString).getLong("id")
    }

    private fun connect(collector: Collector): WebSocketSession {
        val headers = WebSocketHttpHeaders()
        headers.add("X-Microteams-Session", machineToken)
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
}
