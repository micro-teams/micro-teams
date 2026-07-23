/*
 *  Description: End-to-end integration test for the agent chat loop WITHOUT a real Claude:
 *               a fake machine (a real WebSocket client) enrolls and connects; a human opens
 *               an agent on it (creates the agent user + ships a session.create the client
 *               receives); the agent joins a thread; the human posts a message and the client
 *               must receive it as a `say` rpc.call; the "agent" then exchanges its machine +
 *               screen tokens for its own user token (POST /agent/token) and posts through the
 *               ordinary POST /chat/{id}/messages as a Bearer caller, and its reply must appear in
 *               the thread authored by the agent user. This proves the orchestrator, the
 *               chat->agent event hook, the token exchange, and an agent posting as a plain user.
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
import app.microteams.team.membership.TeamService
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
    private val teamService: TeamService,
    private val objectMapper: ObjectMapper,
) {
    @LocalServerPort private var port: Int = 0

    private lateinit var human: UserCreatorService.CreateUserResponse
    private lateinit var humanToken: String
    private var teamId: IdType = -1
    private lateinit var machineId: String
    private lateinit var machineToken: String

    // A distinctive endpoint the fake machine reports on its handshake — deliberately not the
    // server's own address — so asserting it reaches MICROTEAMS_API proves the server echoes each
    // machine's own endpoint rather than assuming one.
    private val reportedOrigin = "https://edge.example.test/mt"

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
        headers.add("X-Microteams-Origin", reportedOrigin)
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
        // Opening an agent enrolls it as a member of its team; without this it cannot read or write
        // its own team's document tree (the git remote + read/write-document are gated on
        // membership).
        assertTrue(
            teamService.isTeamMember(teamId, agentUserId),
            "an opened agent must be a member of its team",
        )
        val create = awaitFrame(collector, "session.create")
        val screenToken = create.getString("screen")
        assertTrue(create.getJSONArray("command").getString(0) == "bash")
        // With no explicit cwd, the agent defaults into a private per-agent checkout under
        // ~/.local/share/microteams, named by its nickname ("Rin" -> rin-<userId>) — not a shared
        // per-team dir.
        assertTrue(
            create
                .getJSONArray("command")
                .getString(2)
                .contains(".local/share/microteams/agents/rin-"),
            "default cwd should be a per-agent dir under ~/.local/share/microteams named by nickname",
        )
        // The screen's MICROTEAMS_API is the endpoint THIS machine reported on its handshake, not
        // the server's configured fallback — so a machine reached via any endpoint calls back on
        // one that works for it.
        assertEquals(reportedOrigin, create.getJSONObject("env").getString("MICROTEAMS_API"))
        // The agent's team travels in the env too, so the applet's `docs` commands know which tree.
        assertEquals(teamId.toString(), create.getJSONObject("env").getString("MICROTEAMS_TEAM"))

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

        // the "agent" exchanges its machine + screen tokens for its own short-lived user token,
        // then replies through the ordinary POST /chat/{id}/messages as a Bearer caller — the exact
        // endpoint and authorization a human uses, proving an agent is just a user
        val tokenRes =
            mockMvc
                .perform(
                    post("/agent/token")
                        .header("X-Microteams-Session", machineToken)
                        .header("X-Microteams-Screen", screenToken)
                )
                .andExpect(status().isOk)
                .andReturn()
        val agentToken = JSONObject(tokenRes.response.contentAsString).getString("token")

        // the agent asks for its document-tree git workspace: its team's remote on the endpoint its
        // machine reported (so the URL is per-machine, not the server's own) plus a git credential
        val wsRes =
            mockMvc
                .perform(get("/agent/git-workspace").header("Authorization", "Bearer $agentToken"))
                .andExpect(status().isOk)
                .andReturn()
        val ws = JSONObject(wsRes.response.contentAsString)
        assertEquals(teamId, ws.getLong("teamId"))
        assertEquals("$reportedOrigin/git/$teamId", ws.getString("gitUrl"))
        assertTrue(ws.getString("token").isNotBlank(), "a git credential must be returned")

        mockMvc
            .perform(
                post("/chat/$threadId/messages")
                    .header("Authorization", "Bearer $agentToken")
                    .contentType("application/json")
                    .content("""{"content":"yes! reporting in."}""")
            )
            .andExpect(status().isCreated)
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
     * The CLI applet — the JavaScript that defines the `microteams api` command tree — is served
     * publicly (the CLI fetches it before it has a token). It must actually be present (the applets
     * module's build copies it into backend resources) and register commands, or a live agent has
     * no tools at all.
     */
    @Test
    fun cliAppletIsServed() {
        mockMvc
            .perform(get("/agent/cli-applet"))
            .andExpect(status().isOk)
            .andExpect(content().string(org.hamcrest.Matchers.containsString("microteams.command")))
    }

    /**
     * GET /agent/drivers lists the drivers this server supports (both @Component AgentDriver beans
     * are registered) plus the default — this is what the open-agent form's driver picker reads.
     */
    @Test
    fun agentDriversListsSupportedDriversAndTheDefault() {
        mockMvc
            .perform(get("/agent/drivers").header("Authorization", "Bearer $humanToken"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.drivers", org.hamcrest.Matchers.hasItem("claude")))
            .andExpect(jsonPath("$.drivers", org.hamcrest.Matchers.hasItem("codex")))
            .andExpect(jsonPath("$.defaultDriver").value("claude"))
    }

    /**
     * 401, not 403: the machine token alone proves which *machine* is calling, never which agent,
     * so the token exchange refuses it without the per-screen token — there is no agent to mint a
     * token for. The machine+screen pair together are the agent's credentials.
     */
    @Test
    fun agentTokenWithoutScreenTokenIsUnauthenticated() {
        mockMvc
            .perform(post("/agent/token").header("X-Microteams-Session", machineToken))
            .andExpect(status().isUnauthorized)
    }

    private fun commandOf(create: JSONObject): String {
        val cmd = create.getJSONArray("command")
        return (0 until cmd.length()).joinToString(" ") { cmd.getString(it) }
    }

    /**
     * A caller may open an agent on a session id it names, and ask that the driver resume it rather
     * than start fresh. The server keeps the id opaque (no Claude semantics leak into AgentService)
     * and passes resume through to driver.command — so the launched argv resumes exactly that
     * session, which is what lets a user pick up a prior session from a chosen cwd.
     */
    @Test
    fun openWithExplicitSessionIdAndResumeLaunchesThatSession() {
        val collector = Collector()
        val session = connect(collector)
        awaitFrame(collector, "welcome")

        val sessionId = UUID.randomUUID().toString()
        mockMvc
            .perform(
                post("/agent")
                    .header("Authorization", "Bearer $humanToken")
                    .contentType("application/json")
                    .content(
                        """{"machineId":"$machineId","teamId":$teamId,"sessionId":"$sessionId","resume":true}"""
                    )
            )
            .andExpect(status().isCreated)

        val create = awaitFrame(collector, "session.create")
        val command = commandOf(create)
        // resume=true -> the Claude driver uses --resume (not --session-id) on the very id we
        // named.
        assertTrue(command.contains("--resume $sessionId"), "argv should resume the named session")

        session.close()
    }

    /**
     * Reboot ends the agent's current screen and relaunches the SAME session (same session id, same
     * cwd) with resume=true, replacing only the backing screen. We assert the old screen is closed,
     * a new one is created resuming the minted session id, and the returned sid differs while the
     * agent user id stays the same — the agent user and its memberships are untouched.
     */
    @Test
    fun rebootReplacesScreenAndResumesSameSession() {
        val collector = Collector()
        val session = connect(collector)
        awaitFrame(collector, "welcome")

        val openRes =
            mockMvc
                .perform(
                    post("/agent")
                        .header("Authorization", "Bearer $humanToken")
                        .contentType("application/json")
                        .content("""{"machineId":"$machineId","teamId":$teamId,"nickname":"Reb"}""")
                )
                .andExpect(status().isCreated)
                .andReturn()
        val agentUserId = JSONObject(openRes.response.contentAsString).getLong("agentUserId")
        val oldSid = JSONObject(openRes.response.contentAsString).getString("sid")

        val firstCreate = awaitFrame(collector, "session.create")
        assertEquals(oldSid, firstCreate.getString("sid"))
        // Recover the minted opaque session id from the fresh-open argv (`--session-id <id>`).
        val mintedSession =
            Regex("--session-id (\\S+)").find(commandOf(firstCreate))!!.groupValues[1]

        val rebootRes =
            mockMvc
                .perform(
                    post("/agent/$agentUserId/reboot").header("Authorization", "Bearer $humanToken")
                )
                .andExpect(status().isOk)
                .andExpect(jsonPath("$.agentUserId").value(agentUserId))
                .andReturn()
        val newSid = JSONObject(rebootRes.response.contentAsString).getString("sid")
        assertTrue(newSid != oldSid, "reboot must swap in a new screen")

        // The old screen is torn down first, then a new one is created resuming the same session.
        val close = awaitFrame(collector, "session.close")
        assertEquals(oldSid, close.getString("sid"))
        val newCreate = awaitFrame(collector, "session.create")
        assertEquals(newSid, newCreate.getString("sid"))
        assertTrue(
            commandOf(newCreate).contains("--resume $mintedSession"),
            "reboot must resume the same session id",
        )

        session.close()
    }
}
