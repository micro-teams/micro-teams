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
 *               It also covers what must not count as the agent dying: a wake tried while the
 *               machine is offline spends none of that back-off budget, and opening the live screen
 *               of a running agent asks the machine nothing — it subscribes at once, and a machine
 *               that stays silent never gets the program respawned.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.api

import app.microteams.agent.AgentLlmChange
import app.microteams.agent.AgentLlmService
import app.microteams.agent.AgentRegistry
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
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
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
    private val agentLlmService: AgentLlmService,
    private val agentWakeup: AgentWakeup,
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
            Machine(machineId = machineId, name = "wakeup-host", token = machineToken),
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
                        .content(
                            """{"machineId":"$machineId","teamId":$teamId,"nickname":"Wik"}""",
                        ),
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
                        .content("""{"title":"wakeup","memberIds":[$agentUserId]}"""),
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
                        .content("""{"name":"$name"}"""),
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
            // A connector's first word is its hello; the server answers nothing before it.
            .also { it.sendMessage(TextMessage("""{"t":"hello","v":2}""")) }
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
    private fun noFrame(type: String, withinMs: Long = 1500, sid: String? = null): Boolean {
        val deadline = System.currentTimeMillis() + withinMs
        while (System.currentTimeMillis() < deadline) {
            val payload = collector.frames.poll(200, TimeUnit.MILLISECONDS) ?: continue
            val obj = JSONObject(payload)
            if (obj.optString("t") == type && (sid == null || obj.optString("sid") == sid))
                return false
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
                """"args":[{"driver":"claude"}]}""",
        )

    /**
     * The whole point: a message to a dead agent revives it and is then delivered, instead of being
     * typed into a corpse.
     */
    @Test
    @Order(1)
    fun aMessageToADeadAgentWakesItAndIsDeliveredAfterwards() {
        // A model API set after the agent opened: the wake must carry it like a fresh launch does.
        agentLlmService.set(
            agentUserId,
            AgentLlmChange(
                provider = "deepseek",
                api = null,
                baseUrl = null,
                model = null,
                apiKey = "sk-wake",
            ),
        )
        reportDead()
        Thread.sleep(300) // let the push land
        assertEquals(
            ScreenState.DEAD,
            machineHub.screen(sid)!!.state,
            "the applet's `status = dead` must be believed",
        )

        mockMvc
            .perform(
                post("/chat/$threadId/messages")
                    .header("Authorization", "Bearer $humanToken")
                    .contentType("application/json")
                    .content("""{"content":"are you still with us?"}"""),
            )
            .andExpect(status().isCreated)

        // It must be respawned rather than typed at: the machine is told to end the session and
        // create it again under the SAME sid and screen token, resuming the same Claude session.
        awaitFrame("session.close")
        val respawn = awaitFrame("session.create")
        assertEquals(sid, respawn.getString("sid"), "waking respawns the screen in place")
        assertEquals(screenToken, respawn.getString("screen"), "the screen token survives a wake")
        assertFalse(respawn.optBoolean("adopt", false), "a wake spawns, it does not adopt")
        assertEquals(
            "sk-wake",
            respawn.getJSONObject("env").optString("MICROTEAMS_LLM_API_KEY"),
            "a woken screen must get the agent's model API key, as an opened one does",
        )
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
        assertEquals(
            ScreenState.LIVE,
            machineHub.screen(sid)!!.state,
            "screenReady means the program is running again",
        )
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
                    .content("""{"content":"and again?"}"""),
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
                        .content(
                            """{"machineId":"$machineId","teamId":$teamId,"nickname":"Vue"}""",
                        ),
                )
                .andExpect(status().isCreated)
                .andReturn()
        val viewedSid = JSONObject(openRes.response.contentAsString).getString("sid")
        awaitFrameFor("session.create", viewedSid)

        send("""{"t":"var.push","sid":"$viewedSid","name":"status","value":"dead"}""")
        Thread.sleep(300)
        assertEquals(ScreenState.DEAD, machineHub.screen(viewedSid)!!.state)

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
     * attach must rebuild all of it from the row, ask the machine, and start the program when the
     * machine reports it gone, rather than closing on "screen not found" and leaving the human with
     * a blank terminal and no explanation.
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
                            """{"machineId":"$machineId","teamId":$teamId,"nickname":"Lost"}""",
                        ),
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

        // Rebuilt from the row, and the machine asked — without waiting — whether the session is
        // still there; the viewer is subscribed meanwhile.
        val adopt = awaitFrameFor("session.create", lostSid)
        assertTrue(adopt.optBoolean("adopt", false), "the machine is asked with an adopt")
        awaitFrameFor("screen.subscribe", lostSid)
        // It is not (the closeScreen above ended it): the machine says so, and only that wakes it.
        send(
            """{"t":"session.error","sid":"$lostSid",""" +
                """"error":"the screen's program is no longer running on this machine"}""",
        )
        // Woken: the program is started again on the SAME screen, and the viewer resubscribed.
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

    /**
     * A machine that is away cannot start anything, so trying to wake an agent there must not use
     * up its back-off budget: otherwise a viewer retrying the live screen through an outage leaves
     * the agent refusing to wake for half an hour after the machine is back.
     */
    @Test
    @Order(6)
    fun aWakeTriedWhileTheMachineIsOfflineSpendsNoAttempt() {
        val (offSid, offUserId) = openAgent("Off")
        send("""{"t":"var.push","sid":"$offSid","name":"status","value":"dead"}""")
        Thread.sleep(300)
        assertEquals(ScreenState.DEAD, machineHub.screen(offSid)!!.state)

        machine.close()
        awaitTrue("the machine must go offline") { !machineHub.isOnline(machineId) }
        assertFalse(
            agentWakeup.ensureAwake(offUserId),
            "nothing can be woken on an offline machine",
        )

        collector = Collector()
        machine = connect(collector)
        awaitFrame("welcome")
        assertTrue(
            agentWakeup.ensureAwake(offUserId),
            "the first wake after it is back must go out",
        )
        awaitFrameFor("session.close", offSid)
        // The reconnect also re-adopts the screen (an `adopt` create), in whichever order the two
        // reach the machine; the wake is the create that spawns.
        var respawn = awaitFrameFor("session.create", offSid)
        if (respawn.optBoolean("adopt", false)) respawn = awaitFrameFor("session.create", offSid)
        assertFalse(
            respawn.optBoolean("adopt", false),
            "it is a wake, not the reconnect's re-adopt",
        )
    }

    /**
     * Opening the live screen of a running agent must not wait on, or test, the machine: the viewer
     * is subscribed straight away, and silence from the machine is never read as death.
     */
    @Test
    @Order(7)
    fun openingTheLiveScreenOfARunningAgentAsksTheMachineNothing() {
        val (liveSid, _) = openAgent("Echo")
        send(
            """{"t":"rpc.call","sid":"$liveSid","id":"c7","name":"screenReady",""" +
                """"args":[{"driver":"claude"}]}""",
        )
        awaitTrue("the screen must be live") {
            machineHub.screen(liveSid)!!.state == ScreenState.LIVE
        }

        val viewer =
            StandardWebSocketClient()
                .execute(
                    Collector(),
                    WebSocketHttpHeaders(),
                    URI(
                        "ws://localhost:$port/machine/screen/$liveSid?token=$humanToken&cols=90&rows=30",
                    ),
                )
        // The first thing the machine hears about this viewer is its subscribe — no probe first.
        val first = awaitFrameFor("screen.subscribe", liveSid)
        assertEquals(90, first.getInt("cols"))
        assertTrue(
            noFrame("session.close", 4000, liveSid),
            "a silent machine must not get the program respawned",
        )
        assertEquals(ScreenState.LIVE, machineHub.screen(liveSid)!!.state)
        viewer.get(5, TimeUnit.SECONDS).close()
    }

    /**
     * A program that dies while a person stays on its screen is not restarted under them: it is
     * woken by the next message or the next opening, as on any other screen.
     */
    @Test
    @Order(8)
    fun aDeathUnderAViewerWhoStaysWakesNothing() {
        val (watchedSid, _) = openAgent("Kit")
        send(
            """{"t":"rpc.call","sid":"$watchedSid","id":"c8","name":"screenReady",""" +
                """"args":[{"driver":"claude"}]}""",
        )
        awaitTrue("the screen must be live") {
            machineHub.screen(watchedSid)!!.state == ScreenState.LIVE
        }
        val viewer =
            StandardWebSocketClient()
                .execute(
                    Collector(),
                    WebSocketHttpHeaders(),
                    URI(
                        "ws://localhost:$port/machine/screen/$watchedSid?token=$humanToken&cols=90&rows=30",
                    ),
                )
                .get(5, TimeUnit.SECONDS)
        awaitFrameFor("screen.subscribe", watchedSid)

        send(
            """{"t":"session.error","sid":"$watchedSid","error":"the screen's tmux session ended"}""",
        )
        awaitTrue("the screen must be dead") {
            machineHub.screen(watchedSid)!!.state == ScreenState.DEAD
        }
        assertTrue(
            noFrame("session.close", 2000, watchedSid),
            "a death under a viewer must not respawn",
        )
        viewer.close()
    }

    /** Open one more agent on the fake machine and return its screen id and user id. */
    private fun openAgent(nickname: String): Pair<String, IdType> {
        val res =
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
        val body = JSONObject(res.response.contentAsString)
        val openedSid = body.getString("sid")
        awaitFrameFor("session.create", openedSid)
        return openedSid to body.getLong("agentUserId")
    }

    private fun awaitTrue(what: String, condition: () -> Boolean) {
        val deadline = System.currentTimeMillis() + 5000
        while (!condition()) {
            if (System.currentTimeMillis() > deadline) error(what)
            Thread.sleep(50)
        }
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
