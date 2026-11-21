/*
 *  Description: Terminals belong to the machine: anyone who can use a machine (through any team it
 *               is in) opens a login shell or a command on it, lists them and closes them; nobody
 *               else can. Drives /machine/{id}/terminal against a fake machine (a real WebSocket
 *               client on the control channel), asserting what the machine is told.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.api

import app.microteams.machine.enrollment.Machine
import app.microteams.machine.enrollment.MachineRepository
import app.microteams.team.machine.TeamMachine
import app.microteams.team.machine.TeamMachineRepository
import java.net.URI
import java.util.UUID
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import org.json.JSONObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.rucca.cheese.utils.UserCreatorService
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import org.springframework.web.socket.TextMessage
import org.springframework.web.socket.WebSocketHttpHeaders
import org.springframework.web.socket.WebSocketSession
import org.springframework.web.socket.client.standard.StandardWebSocketClient
import org.springframework.web.socket.handler.TextWebSocketHandler

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class TerminalTest
@Autowired
constructor(
    private val mockMvc: MockMvc,
    private val userCreatorService: UserCreatorService,
    private val machineRepository: MachineRepository,
    private val teamMachineRepository: TeamMachineRepository,
) {
    @LocalServerPort private var port: Int = 0

    private class Collector : TextWebSocketHandler() {
        val frames = LinkedBlockingQueue<String>()

        override fun handleTextMessage(session: WebSocketSession, message: TextMessage) {
            frames.add(message.payload)
        }
    }

    private fun await(c: Collector, type: String): JSONObject {
        val until = System.currentTimeMillis() + 5000
        while (System.currentTimeMillis() < until) {
            val f = JSONObject(c.frames.poll(500, TimeUnit.MILLISECONDS) ?: continue)
            if (f.getString("t") == type) return f
        }
        error("no '$type' frame arrived in time")
    }

    @Test
    fun whoeverCanUseTheMachineOpensListsAndClosesItsTerminals() {
        val ann =
            userCreatorService.createUser().let {
                userCreatorService.login(it.username, it.password)
            }
        val bob =
            userCreatorService.createUser().let {
                userCreatorService.login(it.username, it.password)
            }
        val team =
            JSONObject(
                    mockMvc
                        .perform(
                            post("/team")
                                .header("Authorization", "Bearer $ann")
                                .contentType("application/json")
                                .content("""{"name":"terminals"}"""),
                        )
                        .andReturn()
                        .response
                        .contentAsString,
                )
                .getLong("id")
        val machineId = "dev" + UUID.randomUUID().toString().replace("-", "").take(12)
        val token = "tok-" + UUID.randomUUID()
        machineRepository.save(Machine(machineId = machineId, name = "box", token = token))
        teamMachineRepository.save(TeamMachine(machineId = machineId, teamId = team))

        val collector = Collector()
        val headers = WebSocketHttpHeaders().apply { add("X-Microteams-Session", token) }
        val link =
            StandardWebSocketClient()
                .execute(collector, headers, URI("ws://localhost:$port/machine/link"))
                .get(5, TimeUnit.SECONDS)
        link.sendMessage(TextMessage("""{"t":"hello","v":2}"""))
        await(collector, "welcome")

        // A login shell, then a command.
        val shell =
            JSONObject(
                mockMvc
                    .perform(
                        post("/machine/$machineId/terminal")
                            .header("Authorization", "Bearer $ann")
                            .contentType("application/json")
                            .content("{}"),
                    )
                    .andExpect(status().isCreated)
                    .andReturn()
                    .response
                    .contentAsString,
            )
        assertEquals("TERMINAL", shell.getString("kind"))
        val create = await(collector, "session.create")
        assertEquals(shell.getString("sid"), create.getString("sid"))
        assertTrue(
            create.getJSONArray("command").getString(2).contains("-l"),
            "a terminal is a login shell",
        )

        mockMvc
            .perform(
                post("/machine/$machineId/terminal")
                    .header("Authorization", "Bearer $ann")
                    .contentType("application/json")
                    .content("""{"command":"echo hi"}"""),
            )
            .andExpect(status().isCreated)
            .andExpect(jsonPath("$.kind").value("COMMAND"))
        assertTrue(
            await(collector, "session.create")
                .getJSONArray("command")
                .getString(2)
                .contains("echo hi"),
        )

        mockMvc
            .perform(get("/machine/$machineId/terminal").header("Authorization", "Bearer $ann"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.terminals.length()").value(2))
        // Bob is in no team the machine is in.
        mockMvc
            .perform(get("/machine/$machineId/terminal").header("Authorization", "Bearer $bob"))
            .andExpect(status().isForbidden)
        mockMvc
            .perform(
                post("/machine/$machineId/terminal")
                    .header("Authorization", "Bearer $bob")
                    .contentType("application/json")
                    .content("{}"),
            )
            .andExpect(status().isForbidden)

        mockMvc
            .perform(
                delete("/machine/$machineId/terminal/${shell.getString("sid")}")
                    .header("Authorization", "Bearer $ann"),
            )
            .andExpect(status().isNoContent)
        assertEquals(shell.getString("sid"), await(collector, "session.close").getString("sid"))
        mockMvc
            .perform(get("/machine/$machineId/terminal").header("Authorization", "Bearer $ann"))
            .andExpect(jsonPath("$.terminals.length()").value(1))
        link.close()
    }
}
