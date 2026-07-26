/*
 *  Description: Integration test for waking a dead agent. A screen outlives the program on it, so
 *               "the agent has a screen" never meant "the agent is listening": Claude Code exits
 *               and tmux keeps the corpse, and before this a message said to that agent was typed
 *               into a dead pane and lost.
 *
 *               A fake machine (a real WebSocket client) enrolls, a human opens an agent on it and
 *               puts it in a group. The machine then reports what the applet reports when it sees
 *               tmux's dead-pane marker (`status = dead`), and the test drives the two moments a
 *               human needs the agent back:
 *
 *               1. 发消息 — a group message must NOT be typed at the corpse. It must respawn the
 *                  screen IN PLACE (same sid, same screen token, `--resume` of the same session so
 *                  the transcript continues) and hold the message until the new program's applet
 *                  announces itself, then deliver it.
 *               2. A second death right after must NOT respawn again — a program that dies on every
 *                  start would otherwise be relaunched in a loop.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.api

import app.microteams.agent.AgentRegistry
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
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
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
@TestMethodOrder(OrderAnnotation::class)
class AgentWakeupTest
@Autowired
constructor(
    private val mockMvc: MockMvc,
    private val userCreatorService: UserCreatorService,
    private val machineHub: MachineHub,
    private val agentRegistry: AgentRegistry,
    private val machineRepository: MachineRepository,
    private val teamMachineRepository: TeamMachineRepository,
) {
    @LocalServerPort private var port: Int = 0

    private lateinit var humanToken: String
    private var teamId: IdType = -1
    private lateinit var machineId: String
    private lateinit var machineToken: String

    private lateinit var machine: WebSocketSession
    private lateinit var collector: Collector
    private var agentUserId: IdType = -1
    private var threadId: IdType = -1
    private lateinit var sid: String
    private lateinit var screenToken: String

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
        teamId = createTeam("Wakeup Team ${UUID.randomUUID().toString().take(6)}")
        machineId = "dev" + UUID.randomUUID().toString().replace("-", "").take(12)
        machineToken = "tok-" + UUID.randomUUID().toString().replace("-", "")
        machineRepository.save(
            Machine(machineId = machineId, name = "wakeup-host", token = machineToken)
        )
        teamMachineRepository.save(TeamMachine(machineId = machineId, teamId = teamId))

        collector = Collector()
        machine = connect(collector)
        awaitFrame("welcome")
        assertTrue(machineHub.isOnline(machineId))

        val openRes =
            mockMvc
                .perform(
                    post("/agent")
                        .header("Authorization", "Bearer $humanToken")
                        .contentType("application/json")
                        .content("""{"machineId":"$machineId","teamId":$teamId,"nickname":"Wik"}""")
                )
                .andExpect(status().isCreated)
                .andReturn()
        agentUserId = JSONObject(openRes.response.contentAsString).getLong("agentUserId")
        sid = JSONObject(openRes.response.contentAsString).getString("sid")
        val create = awaitFrame("session.create")
        screenToken = create.getString("screen")

        val threadRes =
            mockMvc
                .perform(
                    post("/chat")
                        .header("Authorization", "Bearer $humanToken")
                        .contentType("application/json")
                        .content("""{"title":"wakeup","memberIds":[$agentUserId]}""")
                )
                .andExpect(status().isCreated)
                .andReturn()
        threadId = JSONObject(threadRes.response.contentAsString).getLong("id")
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
        val container = jakarta.websocket.ContainerProvider.getWebSocketContainer()
        container.defaultMaxTextMessageBufferSize = 4 * 1024 * 1024
        return StandardWebSocketClient(container)
            .execute(collector, headers, URI("ws://localhost:$port/machine/link"))
            .get(5, TimeUnit.SECONDS)
    }

    private fun awaitFrame(type: String, timeoutMs: Long = 5000): JSONObject {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            val payload = collector.frames.poll(500, TimeUnit.MILLISECONDS) ?: continue
            val obj = JSONObject(payload)
            if (obj.optString("t") == type) return obj
        }
        error("no '$type' frame arrived in time")
    }

    /** Whether a frame of [type] arrives at all — for asserting that one must NOT. */
    private fun noFrame(type: String, withinMs: Long = 1500): Boolean {
        val deadline = System.currentTimeMillis() + withinMs
        while (System.currentTimeMillis() < deadline) {
            val payload = collector.frames.poll(200, TimeUnit.MILLISECONDS) ?: continue
            if (JSONObject(payload).optString("t") == type) return false
        }
        return true
    }

    private fun send(json: String) = machine.sendMessage(TextMessage(json))

    /** What the applet pushes when it sees tmux's dead-pane marker. */
    private fun reportDead() =
        send("""{"t":"var.push","sid":"$sid","name":"status","value":"dead"}""")

    /** What a freshly started applet calls to announce it is driving the program. */
    private fun reportReady() =
        send(
            """{"t":"rpc.call","sid":"$sid","id":"c1","name":"screenReady",""" +
                """"args":[{"driver":"claude"}]}"""
        )

    /**
     * The whole point: a message to a dead agent revives it and is then delivered, instead of being
     * typed into a corpse.
     */
    @Test
    @Order(1)
    fun aMessageToADeadAgentWakesItAndIsDeliveredAfterwards() {
        reportDead()
        Thread.sleep(300) // let the push land
        assertFalse(machineHub.screen(sid)!!.alive, "the applet's `status = dead` must be believed")

        mockMvc
            .perform(
                post("/chat/$threadId/messages")
                    .header("Authorization", "Bearer $humanToken")
                    .contentType("application/json")
                    .content("""{"content":"are you still with us?"}""")
            )
            .andExpect(status().isCreated)

        // It must be respawned rather than typed at: the machine is told to end the session and
        // create it again under the SAME sid and screen token, resuming the same Claude session.
        awaitFrame("session.close")
        val respawn = awaitFrame("session.create")
        assertEquals(sid, respawn.getString("sid"), "waking respawns the screen in place")
        assertEquals(screenToken, respawn.getString("screen"), "the screen token survives a wake")
        assertFalse(respawn.optBoolean("adopt", false), "a wake spawns, it does not adopt")
        assertTrue(
            respawn.getJSONArray("command").getString(2).contains("--resume"),
            "the woken program must continue the same session, not start a blank one",
        )

        // The message is held while the program starts — typing into a terminal that is still
        // painting loses it — and delivered once the applet announces itself.
        assertTrue(noFrame("rpc.call"), "nothing may be typed before the new program is ready")
        reportReady()
        val say = awaitFrame("rpc.call")
        assertEquals("say", say.getString("name"))
        assertTrue(
            say.getJSONArray("args").getString(0).contains("are you still with us?"),
            "the message said while it was dead must arrive once it is back",
        )
        assertTrue(machineHub.screen(sid)!!.alive, "screenReady means the program is running again")
    }

    /**
     * A program that dies again immediately must not be relaunched immediately: the second wake is
     * held back, so a crash-on-start loop cannot spin the machine (and burn the agent's credits).
     */
    @Test
    @Order(2)
    fun aSecondDeathRightAfterIsNotRelaunchedImmediately() {
        reportDead()
        Thread.sleep(300)
        mockMvc
            .perform(
                post("/chat/$threadId/messages")
                    .header("Authorization", "Bearer $humanToken")
                    .contentType("application/json")
                    .content("""{"content":"and again?"}""")
            )
            .andExpect(status().isCreated)
        assertTrue(
            noFrame("session.create", 2000),
            "a second death within the back-off window must not respawn the screen",
        )
        // Nothing is lost, though: it stays queued for whenever the agent is up again.
        assertTrue(noFrame("rpc.call"), "and nothing is typed at the dead program either")
    }

    /** The agent is still the same user on the same screen throughout — waking replaces neither. */
    @Test
    @Order(3)
    fun wakingKeepsTheAgentAndItsScreenIdentity() {
        val agent = agentRegistry.bySid(sid)
        assertTrue(agent != null, "the agent must still be registered under the same screen id")
        assertEquals(agentUserId, agent!!.userId)
    }

    /**
     * Watching the live screen is the other moment the agent must be alive: opening the live screen
     * of a dead agent would otherwise show the frozen last frame of whatever killed it, with no way
     * to tell that from an agent that is merely quiet. Uses a second, untouched agent so this is a
     * first wake rather than one held back by the previous test's back-off.
     */
    @Test
    @Order(4)
    fun openingTheLiveScreenOfADeadAgentWakesIt() {
        val openRes =
            mockMvc
                .perform(
                    post("/agent")
                        .header("Authorization", "Bearer $humanToken")
                        .contentType("application/json")
                        .content("""{"machineId":"$machineId","teamId":$teamId,"nickname":"Vue"}""")
                )
                .andExpect(status().isCreated)
                .andReturn()
        val viewedSid = JSONObject(openRes.response.contentAsString).getString("sid")
        awaitFrameFor("session.create", viewedSid)

        send("""{"t":"var.push","sid":"$viewedSid","name":"status","value":"dead"}""")
        Thread.sleep(300)
        assertFalse(machineHub.screen(viewedSid)!!.alive)

        // A human opens the live screen on it. The attach itself must revive the program.
        val viewer =
            StandardWebSocketClient()
                .execute(
                    Collector(),
                    WebSocketHttpHeaders(),
                    URI("ws://localhost:$port/machine/screen/$viewedSid?token=$humanToken"),
                )
                .get(5, TimeUnit.SECONDS)

        awaitFrameFor("session.close", viewedSid)
        val respawn = awaitFrameFor("session.create", viewedSid)
        assertTrue(
            respawn.getJSONArray("command").getString(2).contains("--resume"),
            "watching must resume the agent's own session, not start a blank one",
        )
        // And the viewer is attached to the same screen it asked for — waking respawned in place.
        awaitFrameFor("screen.subscribe", viewedSid)
        viewer.close()
    }

    /**
     * Opening the live screen must ENSURE there is something to look at, not assume it. Here the
     * server has forgotten the screen completely — no hub registration, no registry entry, only the
     * persisted row — which is what a restart that never re-adopted this screen leaves behind. The
     * attach must rebuild all of it from the row and start the program, rather than closing on
     * "screen not found" and leaving the human with a blank terminal and no explanation.
     */
    @Test
    @Order(5)
    fun openingTheLiveScreenRebuildsAScreenTheServerHasForgotten() {
        val openRes =
            mockMvc
                .perform(
                    post("/agent")
                        .header("Authorization", "Bearer $humanToken")
                        .contentType("application/json")
                        .content(
                            """{"machineId":"$machineId","teamId":$teamId,"nickname":"Lost"}"""
                        )
                )
                .andExpect(status().isCreated)
                .andReturn()
        val lostSid = JSONObject(openRes.response.contentAsString).getString("sid")
        val lostUserId = JSONObject(openRes.response.contentAsString).getLong("agentUserId")
        awaitFrameFor("session.create", lostSid)

        // Forget it as thoroughly as a restart would: out of the hub, out of the registry. Only the
        // AgentScreen row is left — which is all the viewer path may rely on.
        machineHub.closeScreen(machineId, lostSid)
        agentRegistry.unregister(lostUserId)
        assertTrue(machineHub.screen(lostSid) == null)
        assertTrue(agentRegistry.bySid(lostSid) == null)

        // The UI only offers the live screen for an agent that is online AND carries a screen id,
        // so a
        // forgotten agent must still be described from its row — otherwise the human cannot even
        // ask for the rebuild.
        mockMvc
            .perform(get("/agent?userId=$lostUserId").header("Authorization", "Bearer $humanToken"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.agents[0].online").value(true))
            .andExpect(jsonPath("$.agents[0].sid").value(lostSid))

        val viewer =
            StandardWebSocketClient()
                .execute(
                    Collector(),
                    WebSocketHttpHeaders(),
                    URI("ws://localhost:$port/machine/screen/$lostSid?token=$humanToken"),
                )
                .get(5, TimeUnit.SECONDS)

        // Rebuilt: the program is started again on the SAME screen, and the viewer attaches to it.
        val respawn = awaitFrameFor("session.create", lostSid)
        assertTrue(
            respawn.getJSONArray("command").getString(2).contains("--resume"),
            "the rebuilt screen must resume the agent's own session",
        )
        awaitFrameFor("screen.subscribe", lostSid)
        assertTrue(machineHub.screen(lostSid) != null, "the screen must be known to the hub again")
        assertTrue(
            agentRegistry.bySid(lostSid) != null,
            "and the agent must be reachable by chat again",
        )
        viewer.close()
    }

    private fun awaitFrameFor(type: String, sid: String, timeoutMs: Long = 8000): JSONObject {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            val payload = collector.frames.poll(500, TimeUnit.MILLISECONDS) ?: continue
            val obj = JSONObject(payload)
            if (obj.optString("t") == type && obj.optString("sid") == sid) return obj
        }
        error("no '$type' frame for screen $sid arrived in time")
    }
}
