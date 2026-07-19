/*
 *  Description: Integration test for the hot-upgrade: a backend redeploy must not orphan running
 *               agents. A fake machine (a real WebSocket client) connects and a human opens an
 *               agent on it (registered + a session.create the client receives). We then clear the
 *               AgentRegistry to simulate a server that lost its in-memory state WITHOUT closing the
 *               screen (the tmux survives on the machine), and drive the reconnect path: the fake
 *               machine reconnects, MachineConnectedEvent fires, and the agent module must re-adopt
 *               its screen — the reconnected client receives a session.create with adopt=true for
 *               the SAME sid, and the agent is live again in the registry. Finally, a machine with
 *               no agent rows reconnecting must be a harmless no-op.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.api

import app.microteams.agent.AgentRegistry
import app.microteams.machine.MachineConnectedEvent
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
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
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
import org.springframework.context.ApplicationEventPublisher
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
class AgentReadoptTest
@Autowired
constructor(
    private val mockMvc: MockMvc,
    private val userCreatorService: UserCreatorService,
    private val machineHub: MachineHub,
    private val agentRegistry: AgentRegistry,
    private val eventPublisher: ApplicationEventPublisher,
    private val machineRepository: MachineRepository,
    private val teamMachineRepository: TeamMachineRepository,
) {
    @LocalServerPort private var port: Int = 0

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
        val human = userCreatorService.createUser()
        humanToken = userCreatorService.login(human.username, human.password)
        teamId = createTeam("Readopt Team ${UUID.randomUUID().toString().take(6)}")
        machineId = "dev" + UUID.randomUUID().toString().replace("-", "").take(12)
        machineToken = "tok-" + UUID.randomUUID().toString().replace("-", "")
        machineRepository.save(
            Machine(machineId = machineId, name = "readopt-host", token = machineToken)
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
        // session.create ships the full applet source (>8 KB), so the client must accept large
        // text frames — raise the container's default buffer.
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

    /**
     * The whole hot-upgrade in one test: open an agent, throw away the in-memory registry as a
     * restart would, and prove a reconnect re-adopts the still-running screen.
     */
    @Test
    @Order(1)
    fun reconnectReadoptsTheSurvivingScreen() {
        val first = Collector()
        val firstSession = connect(first)
        awaitFrame(first, "welcome")
        assertTrue(machineHub.isOnline(machineId))

        // A human opens an agent -> agent user + a (fresh, non-adopt) session.create to the client.
        val openRes =
            mockMvc
                .perform(
                    post("/agent")
                        .header("Authorization", "Bearer $humanToken")
                        .contentType("application/json")
                        .content("""{"machineId":"$machineId","teamId":$teamId,"nickname":"Hot"}""")
                )
                .andExpect(status().isCreated)
                .andReturn()
        val agentUserId = JSONObject(openRes.response.contentAsString).getLong("agentUserId")
        val sid = JSONObject(openRes.response.contentAsString).getString("sid")
        val open = awaitFrame(first, "session.create")
        assertEquals(sid, open.getString("sid"))
        assertTrue(!open.optBoolean("adopt", false), "the first open is not an adopt")
        assertNotNull(agentRegistry.get(agentUserId), "the freshly opened agent must be registered")

        // Simulate a server that lost its in-memory state WITHOUT closing the screen: drop the
        // registry entry only. The AgentScreen row and the surviving tmux (the fake machine still
        // holds the WS) are untouched — exactly the state after a redeploy.
        agentRegistry.unregister(agentUserId)
        assertNull(agentRegistry.get(agentUserId), "registry cleared, standing in for a restart")

        // The machine reconnects (a brand-new control channel), which fires MachineConnectedEvent.
        firstSession.close()
        val second = Collector()
        val secondSession = connect(second)
        awaitFrame(second, "welcome")

        // The agent module must re-adopt: the reconnected client receives a session.create with
        // adopt=true for the SAME sid, re-driving the surviving tmux rather than spawning anew.
        val readopt = awaitFrame(second, "session.create")
        assertEquals(sid, readopt.getString("sid"), "re-adopts the same screen id")
        assertTrue(readopt.optBoolean("adopt", false), "re-adoption must set adopt=true")

        // And the agent is live again in the registry — online, reachable by chat, no human action.
        assertNotNull(agentRegistry.get(agentUserId), "the agent must be live again after re-adopt")

        secondSession.close()
    }

    /** A machine that carries no agent rows reconnecting must do nothing at all — a clean no-op. */
    @Test
    @Order(2)
    fun connectWithNoAgentRowsIsANoOp() {
        val strangerMachineId = "dev" + UUID.randomUUID().toString().replace("-", "").take(12)
        // Publishing the event directly is enough: findByMachineId is empty, so the listener's loop
        // body never runs. It must not throw and must register nothing.
        eventPublisher.publishEvent(MachineConnectedEvent(strangerMachineId))
        assertTrue(
            agentRegistry.screenAgents().none { it.machineId == strangerMachineId },
            "a machine with no agent rows must not gain any agents on connect",
        )
    }
}
