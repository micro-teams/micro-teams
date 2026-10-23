/*
 *  Description: Integration test for `PUT /agent/{userId}/llm` — the model API an agent's program
 *               uses (dsh). What it pins is the contract around the secret: the key is accepted,
 *               reaches the screen environment, and is never given back — not in the response, not
 *               on the agent view, not even to the people allowed to set it. Plus the edit
 *               semantics the UI relies on (omitted key = keep, empty = clear, provider none =
 *               remove), validation of a custom endpoint, and the usual team-membership rule.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.api

import app.microteams.agent.AgentLlmService
import app.microteams.agent.screen.AgentScreen
import app.microteams.agent.screen.AgentScreenRepository
import java.time.LocalDateTime
import java.util.UUID
import org.json.JSONObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
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
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.*

@SpringBootTest
@AutoConfigureMockMvc
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(OrderAnnotation::class)
class AgentLlmTest
@Autowired
constructor(
    private val mockMvc: MockMvc,
    private val userCreatorService: UserCreatorService,
    private val agentScreenRepository: AgentScreenRepository,
    private val agentLlmService: AgentLlmService,
) {
    private val secret = "sk-test-" + UUID.randomUUID().toString().replace("-", "")
    private lateinit var memberToken: String
    private lateinit var outsiderToken: String
    private var agentUserId: IdType = -1

    @BeforeAll
    fun prepare() {
        val human = userCreatorService.createUser()
        memberToken = userCreatorService.login(human.username, human.password)
        val outsider = userCreatorService.createUser()
        outsiderToken = userCreatorService.login(outsider.username, outsider.password)
        val team =
            mockMvc
                .perform(
                    post("/team")
                        .header("Authorization", "Bearer $memberToken")
                        .contentType("application/json")
                        .content("""{"name":"Agent LLM ${UUID.randomUUID().toString().take(6)}"}"""),
                )
                .andExpect(status().isCreated)
                .andReturn()
        val teamId = JSONObject(team.response.contentAsString).getLong("id")
        agentUserId = userCreatorService.createUser().userId
        agentScreenRepository.save(
            AgentScreen(
                sid = "s" + UUID.randomUUID().toString().replace("-", "").take(8),
                machineId = "dev" + UUID.randomUUID().toString().replace("-", "").take(12),
                token = UUID.randomUUID().toString().replace("-", ""),
                teamId = teamId,
                agentUserId = agentUserId,
                sessionId = UUID.randomUUID().toString(),
                cwd = null,
                driver = "dsh",
                createdAt = LocalDateTime.now(),
            ),
        )
    }

    private fun putLlm(body: String, token: String = memberToken) =
        mockMvc.perform(
            put("/agent/$agentUserId/llm")
                .header("Authorization", "Bearer $token")
                .contentType("application/json")
                .content(body),
        )

    private fun agentView(): String =
        mockMvc
            .perform(get("/agent?userId=$agentUserId").header("Authorization", "Bearer $memberToken"))
            .andExpect(status().isOk)
            .andReturn()
            .response
            .contentAsString

    /** The key goes in, reaches the screen environment, and never comes back out. */
    @Test
    @Order(1)
    fun theKeyIsWriteOnly() {
        val body =
            putLlm("""{"provider":"deepseek","model":"deepseek-v4-flash","apiKey":"$secret"}""")
                .andExpect(status().isOk)
                .andExpect(jsonPath("$.llm.provider").value("deepseek"))
                .andExpect(jsonPath("$.llm.model").value("deepseek-v4-flash"))
                .andExpect(jsonPath("$.llm.hasApiKey").value(true))
                .andReturn()
                .response
                .contentAsString
        assertFalse(body.contains(secret), "the response carried the key")
        assertFalse(agentView().contains(secret), "the agent view carried the key")

        val env = agentLlmService.screenEnv(agentUserId)
        assertEquals("deepseek", env["MICROTEAMS_LLM_PROVIDER"])
        assertEquals(secret, env["MICROTEAMS_LLM_API_KEY"])
        assertEquals("deepseek-v4-flash", env["MICROTEAMS_LLM_MODEL"])
    }

    /** Re-sending the setting without a key keeps it; an empty key removes it. */
    @Test
    @Order(2)
    fun anOmittedKeyIsKeptAndAnEmptyOneRemoved() {
        putLlm("""{"provider":"deepseek","model":"deepseek-v4-pro"}""")
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.llm.hasApiKey").value(true))
        assertEquals(secret, agentLlmService.screenEnv(agentUserId)["MICROTEAMS_LLM_API_KEY"])

        putLlm("""{"provider":"deepseek","apiKey":""}""")
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.llm.hasApiKey").value(false))
        assertNull(agentLlmService.screenEnv(agentUserId)["MICROTEAMS_LLM_API_KEY"])
    }

    /** A custom endpoint must say how to reach it; a half-filled one is refused, not stored. */
    @Test
    @Order(3)
    fun aCustomEndpointIsValidated() {
        putLlm("""{"provider":"custom","api":"openai-completions","model":"m"}""")
            .andExpect(status().isBadRequest)
        putLlm("""{"provider":"custom","api":"openai-completions","baseUrl":"ftp://x/v1","model":"m"}""")
            .andExpect(status().isBadRequest)
        putLlm("""{"provider":"custom","baseUrl":"https://gw.example/v1","model":"m"}""")
            .andExpect(status().isBadRequest)

        putLlm(
                """{"provider":"custom","api":"anthropic-messages","baseUrl":"https://gw.example/v1",""" +
                    """"model":"claude-x","apiKey":"$secret"}""",
            )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.llm.api").value("anthropic-messages"))
            .andExpect(jsonPath("$.llm.baseUrl").value("https://gw.example/v1"))
        val env = agentLlmService.screenEnv(agentUserId)
        assertEquals("anthropic-messages", env["MICROTEAMS_LLM_API"])
        assertEquals("https://gw.example/v1", env["MICROTEAMS_LLM_BASE_URL"])
    }

    /** Somebody outside the agent's team may not point its program at their own endpoint. */
    @Test
    @Order(4)
    fun anOutsiderIsRefused() {
        putLlm("""{"provider":"deepseek","apiKey":"sk-evil"}""", outsiderToken)
            .andExpect(status().isForbidden)
        assertEquals(secret, agentLlmService.screenEnv(agentUserId)["MICROTEAMS_LLM_API_KEY"])
    }

    /** provider none removes the whole setting: the program falls back to its machine's config. */
    @Test
    @Order(5)
    fun providerNoneRemovesTheSetting() {
        putLlm("""{"provider":"none"}""").andExpect(status().isOk).andExpect(jsonPath("$.llm").doesNotExist())
        assertTrue(agentLlmService.screenEnv(agentUserId).isEmpty())
    }
}
