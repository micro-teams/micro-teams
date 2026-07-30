/*
 *  Description: Integration test for `PUT /agent/{userId}/avatar` — giving an agent a picture.
 *
 *               The interesting part is not the endpoint but who performs the change. The three
 *               profile tables belong to the identity service and are read-only here, and its API
 *               lets a user modify only their own profile — so a human's token can never write an
 *               agent's. The server therefore acts AS THE AGENT, with a token it signs itself, which
 *               identity accepts as ordinary self-modification.
 *
 *               So this test runs against the real identity service (as every test here does) and
 *               checks the two things that could silently go wrong: the avatar really changes, and
 *               the nickname is NOT collateral damage — identity replaces the whole profile, so
 *               sending only an avatar would erase who the agent is.
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
import org.junit.jupiter.api.Assertions.assertNotEquals
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
class AgentAvatarTest
@Autowired
constructor(
    private val mockMvc: MockMvc,
    private val userCreatorService: UserCreatorService,
    private val agentScreenRepository: AgentScreenRepository,
    private val applicationConfig: org.rucca.cheese.common.config.ApplicationConfig,
) {
    private lateinit var teamMemberToken: String
    private lateinit var outsiderToken: String
    private var teamId: IdType = -1
    private var agentUserId: IdType = -1
    private var agentNickname: String = ""

    /** A real, different avatar to switch to: one of identity's predefined ones. */
    private var someAvatarId: Int = -1

    @BeforeAll
    fun prepare() {
        val human = userCreatorService.createUser()
        teamMemberToken = userCreatorService.login(human.username, human.password)
        val outsider = userCreatorService.createUser()
        outsiderToken = userCreatorService.login(outsider.username, outsider.password)
        // Every user starts on the same default avatar, so switching to another user's would prove
        // nothing. Ask identity for a predefined one — the same list the avatar picker offers.
        someAvatarId = predefinedAvatarId(teamMemberToken, notThis = human.avatarId.toInt())

        teamId = createTeam("Agent Avatar ${UUID.randomUUID().toString().take(6)}")

        // A user with an AgentScreen row IS an agent, which is all this endpoint's rule asks about.
        val agent = userCreatorService.createUser()
        agentUserId = agent.userId
        agentNickname = agent.nickname
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

    /** A predefined avatar id from the identity service, other than [notThis]. */
    private fun predefinedAvatarId(token: String, notThis: Int): Int {
        val client = jakarta.ws.rs.client.ClientBuilder.newClient()
        val body =
            client
                .target(applicationConfig.legacyUrl)
                .path("/avatars")
                .queryParam("type", "predefined")
                .request()
                .header("Authorization", "Bearer $token")
                .get()
                .readEntity(String::class.java)
        val ids = JSONObject(body).getJSONObject("data").getJSONArray("avatarIds")
        for (i in 0 until ids.length()) {
            val id = ids.getInt(i)
            if (id != notThis) return id
        }
        error("identity offers no predefined avatar other than $notThis")
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

    /**
     * The point of the whole feature: a team member can give the agent a picture even though the
     * identity service would refuse their token for another user's profile — and the agent keeps
     * its name, which a whole-profile replace would otherwise wipe.
     */
    @Test
    @Order(1)
    fun aTeamMemberCanSetTheAgentsAvatarWithoutLosingItsNickname() {
        val before = agentDTO(teamMemberToken)
        assertNotEquals(
            someAvatarId,
            before.optInt("avatarId", -1),
            "the test needs a genuinely different avatar to switch to",
        )

        mockMvc
            .perform(
                put("/agent/$agentUserId/avatar")
                    .header("Authorization", "Bearer $teamMemberToken")
                    .contentType("application/json")
                    .content("""{"avatarId":$someAvatarId}""")
            )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.avatarId").value(someAvatarId))
            .andExpect(jsonPath("$.nickname").value(agentNickname))

        // And it stuck, as read back by the ordinary enumeration.
        val after = agentDTO(teamMemberToken)
        assertEquals(someAvatarId, after.getInt("avatarId"))
        assertEquals(agentNickname, after.getString("nickname"), "the nickname must survive")
    }

    /** Not this agent's team, not your agent: the same rule as close and reboot. */
    @Test
    @Order(2)
    fun anOutsiderMayNotSetIt() {
        mockMvc
            .perform(
                put("/agent/$agentUserId/avatar")
                    .header("Authorization", "Bearer $outsiderToken")
                    .contentType("application/json")
                    .content("""{"avatarId":$someAvatarId}""")
            )
            .andExpect(status().isForbidden)
    }
}
