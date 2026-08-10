/*
 *  Description: Listing a team's agents must include the ones this server holds nothing live for.
 *
 *               An agent exists as a persisted AgentScreen row; the in-memory registry is only what
 *               the server has re-adopted since it last started. So after every deploy — or for as
 *               long as a machine stays disconnected — an agent has a row and no live entry, and
 *               that is precisely when a human goes looking for it.
 *
 *               The bug this pins: `GET /agent?teamId=` narrowed candidates by the LIVE entry's
 *               teamId alone, so an agent with only a row was dropped by the very filter the UI
 *               always sends. It looked like the agents had been deleted. `toDTO` had already been
 *               taught to describe such an agent from its row (see AgentWakeupTest); the filters
 *               above it had not.
 *
 *  Author(s):
 *      agent3
 *
 */

package app.microteams.api

import app.microteams.agent.screen.AgentScreen
import app.microteams.agent.screen.AgentScreenRepository
import java.time.LocalDateTime
import java.util.UUID
import org.json.JSONObject
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.rucca.cheese.common.persistent.IdType
import org.rucca.cheese.utils.UserCreatorService
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class AgentListOfflineTest
@Autowired
constructor(
    private val mockMvc: MockMvc,
    private val userCreatorService: UserCreatorService,
    private val agentScreenRepository: AgentScreenRepository,
) {
    private lateinit var token: String
    private var teamId: IdType = -1
    private var agentUserId: IdType = -1
    private val machineId = "dev" + UUID.randomUUID().toString().replace("-", "").take(12)

    @BeforeAll
    fun prepare() {
        val human = userCreatorService.createUser()
        token = userCreatorService.login(human.username, human.password)
        teamId = createTeam("Offline Agents ${UUID.randomUUID().toString().take(6)}")

        // A row and nothing else: no machine connected, no live registry entry — the state every
        // agent is in immediately after the server restarts.
        val agent = userCreatorService.createUser()
        agentUserId = agent.userId
        agentScreenRepository.save(
            AgentScreen(
                sid = "s" + UUID.randomUUID().toString().replace("-", "").take(8),
                machineId = machineId,
                token = UUID.randomUUID().toString().replace("-", ""),
                teamId = teamId,
                agentUserId = agentUserId,
                sessionId = UUID.randomUUID().toString(),
                cwd = null,
                driver = "claude",
                createdAt = LocalDateTime.now(),
            )
        )
    }

    /** The filter the UI always sends. Both shells call listAgents({ teamId }) and nothing else. */
    @Test
    fun anOfflineAgentIsStillListedForItsTeam() {
        mockMvc
            .perform(get("/agent?teamId=$teamId").header("Authorization", "Bearer $token"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.agents[0].userId").value(agentUserId))
            .andExpect(jsonPath("$.agents[0].online").value(false))
    }

    /** The same fallback, for the other filter that reads a live-only field. */
    @Test
    fun anOfflineAgentIsStillListedForItsMachine() {
        mockMvc
            .perform(get("/agent?machineId=$machineId").header("Authorization", "Bearer $token"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.agents[0].userId").value(agentUserId))
    }

    private fun createTeam(name: String): IdType {
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
}
