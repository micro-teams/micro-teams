/*
 *  Description: Integration test for `PUT /agent/{userId}/keepalive` — turning an agent's cache
 *               keepalive on and off.
 *
 *               Unlike avatar/nickname, this writes only MicroTeams' own scheduling row, not the
 *               identity profile, so there is no cross-service subtlety to guard against. What the
 *               test pins is the contract the UI relies on: enabling persists (enabled + interval
 *               come back on the agent view), enabling without an interval is rejected, disabling
 *               turns it off, and the same team-membership rule as the other manage-an-agent
 *               actions keeps outsiders out. The poller and the actual touch are not exercised here
 *               — they need a live screen — this is the settings surface only.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.api

import app.microteams.agent.screen.AgentScreen
import app.microteams.agent.screen.AgentScreenRepository
import java.time.LocalDateTime
import java.util.UUID
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
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.*

@SpringBootTest
@AutoConfigureMockMvc
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(OrderAnnotation::class)
class AgentKeepaliveTest
@Autowired
constructor(
    private val mockMvc: MockMvc,
    private val userCreatorService: UserCreatorService,
    private val agentScreenRepository: AgentScreenRepository,
) {
    private lateinit var teamMemberToken: String
    private lateinit var outsiderToken: String
    private var teamId: IdType = -1
    private var agentUserId: IdType = -1

    @BeforeAll
    fun prepare() {
        val human = userCreatorService.createUser()
        teamMemberToken = userCreatorService.login(human.username, human.password)
        val outsider = userCreatorService.createUser()
        outsiderToken = userCreatorService.login(outsider.username, outsider.password)

        teamId = createTeam("Agent Keepalive ${UUID.randomUUID().toString().take(6)}")

        val agent = userCreatorService.createUser()
        agentUserId = agent.userId
        agentScreenRepository.save(
            AgentScreen(
                sid = "s" + UUID.randomUUID().toString().replace("-", "").take(8),
                machineId = "dev" + UUID.randomUUID().toString().replace("-", "").take(12),
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

    private fun createTeam(name: String): IdType {
        val res =
            mockMvc
                .perform(
                    post("/team")
                        .header("Authorization", "Bearer $teamMemberToken")
                        .contentType("application/json")
                        .content("""{"name":"$name"}""")
                )
                .andExpect(status().isCreated)
                .andReturn()
        return JSONObject(res.response.contentAsString).getLong("id")
    }

    private fun agentDTO(token: String): JSONObject {
        val res =
            mockMvc
                .perform(get("/agent?userId=$agentUserId").header("Authorization", "Bearer $token"))
                .andExpect(status().isOk)
                .andReturn()
        return JSONObject(res.response.contentAsString).getJSONArray("agents").getJSONObject(0)
    }

    /** Enabling persists, and the schedule reads back on the ordinary agent view. */
    @Test
    @Order(1)
    fun aTeamMemberCanEnableKeepalive() {
        mockMvc
            .perform(
                put("/agent/$agentUserId/keepalive")
                    .header("Authorization", "Bearer $teamMemberToken")
                    .contentType("application/json")
                    .content("""{"enabled":true,"intervalSeconds":2400}""")
            )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.keepalive.enabled").value(true))
            .andExpect(jsonPath("$.keepalive.intervalSeconds").value(2400))

        val after = agentDTO(teamMemberToken).getJSONObject("keepalive")
        assertTrue(after.getBoolean("enabled"))
        assertEquals(2400L, after.getLong("intervalSeconds"))
    }

    /** Enabling without an interval (and none remembered) is a bad request, not a silent no-op. */
    @Test
    @Order(2)
    fun enablingRequiresAnInterval() {
        val fresh = userCreatorService.createUser()
        agentScreenRepository.save(
            AgentScreen(
                sid = "s" + UUID.randomUUID().toString().replace("-", "").take(8),
                machineId = "dev" + UUID.randomUUID().toString().replace("-", "").take(12),
                token = UUID.randomUUID().toString().replace("-", ""),
                teamId = teamId,
                agentUserId = fresh.userId,
                sessionId = UUID.randomUUID().toString(),
                cwd = null,
                driver = "claude",
                createdAt = LocalDateTime.now(),
            )
        )
        mockMvc
            .perform(
                put("/agent/${fresh.userId}/keepalive")
                    .header("Authorization", "Bearer $teamMemberToken")
                    .contentType("application/json")
                    .content("""{"enabled":true}""")
            )
            .andExpect(status().isBadRequest)
    }

    /** Disabling turns it off; the agent view reflects it. */
    @Test
    @Order(3)
    fun aTeamMemberCanDisableKeepalive() {
        mockMvc
            .perform(
                put("/agent/$agentUserId/keepalive")
                    .header("Authorization", "Bearer $teamMemberToken")
                    .contentType("application/json")
                    .content("""{"enabled":false}""")
            )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.keepalive.enabled").value(false))

        assertFalse(agentDTO(teamMemberToken).getJSONObject("keepalive").getBoolean("enabled"))
    }

    /** Not this agent's team: the same rule as close/reboot/rename. */
    @Test
    @Order(4)
    fun anOutsiderMayNotChangeKeepalive() {
        mockMvc
            .perform(
                put("/agent/$agentUserId/keepalive")
                    .header("Authorization", "Bearer $outsiderToken")
                    .contentType("application/json")
                    .content("""{"enabled":true,"intervalSeconds":2400}""")
            )
            .andExpect(status().isForbidden)
    }
}
