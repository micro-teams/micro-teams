/*
 *  Description: Integration test for `GET /chat?queryIsMemberAgent=true` — the chat list being able
 *               to say which of a group's members are agents.
 *
 *               The list draws a group whose only non-human member is one agent with that agent's
 *               avatar, and it used to work out who was an agent from a separate, asynchronously
 *               loaded enumeration — so the first paint showed a generic member grid and corrected
 *               itself a moment later (T-040). The fix is to let the answer travel with the list;
 *               these tests pin the contract that makes that safe.
 *
 *               Being an agent is derived from having an AgentScreen row (the same definition the
 *               agent module itself uses), so the rows are inserted directly rather than by opening
 *               a real screen on a real machine — this is about what the chat list reports, not
 *               about the orchestrator.
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
class ChatMemberAgentTest
@Autowired
constructor(
    private val mockMvc: MockMvc,
    private val userCreatorService: UserCreatorService,
    private val agentScreenRepository: AgentScreenRepository,
) {
    private lateinit var humanToken: String
    private var humanId: IdType = -1
    private var otherHumanId: IdType = -1
    private var agentOneId: IdType = -1
    private var agentTwoId: IdType = -1
    private var teamId: IdType = -1

    /** A chat with exactly one agent in it — what the list draws with that agent's avatar. */
    private var oneAgentChat: IdType = -1

    /** Two agents: the list must fall back to a member grid, so both must be reported. */
    private var twoAgentChat: IdType = -1

    /** No agents at all — an ordinary group. */
    private var humansOnlyChat: IdType = -1

    @BeforeAll
    fun prepare() {
        val human = userCreatorService.createUser()
        humanToken = userCreatorService.login(human.username, human.password)
        humanId = human.userId
        otherHumanId = userCreatorService.createUser().userId
        agentOneId = userCreatorService.createUser().userId
        agentTwoId = userCreatorService.createUser().userId
        // An agent may only be pulled into a group by someone who belongs to every team it works
        // for (no-foreign-agent-in-created-thread), so give both agents the caller's own team.
        teamId = createTeam("Chat Member Agent ${UUID.randomUUID().toString().take(6)}")
        // What makes a user an agent: it has a screen. (No machine is involved here.)
        makeAgent(agentOneId)
        makeAgent(agentTwoId)

        oneAgentChat = createChat("one agent", listOf(agentOneId, otherHumanId))
        twoAgentChat = createChat("two agents", listOf(agentOneId, agentTwoId))
        humansOnlyChat = createChat("humans only", listOf(otherHumanId))
    }

    private fun makeAgent(userId: IdType) {
        agentScreenRepository.save(
            AgentScreen(
                sid = "s" + UUID.randomUUID().toString().replace("-", "").take(8),
                machineId = "dev" + UUID.randomUUID().toString().replace("-", "").take(12),
                token = UUID.randomUUID().toString().replace("-", ""),
                teamId = teamId,
                agentUserId = userId,
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
                        .header("Authorization", "Bearer $humanToken")
                        .contentType("application/json")
                        .content("""{"name":"$name"}""")
                )
                .andExpect(status().isCreated)
                .andReturn()
        return JSONObject(res.response.contentAsString).getLong("id")
    }

    private fun createChat(title: String, memberIds: List<IdType>): IdType {
        val res =
            mockMvc
                .perform(
                    post("/chat")
                        .header("Authorization", "Bearer $humanToken")
                        .contentType("application/json")
                        .content(
                            """{"title":"$title","memberIds":${memberIds.joinToString(",", "[", "]")}}"""
                        )
                )
                .andExpect(status().isCreated)
                .andReturn()
        return JSONObject(res.response.contentAsString).getLong("id")
    }

    private fun listChats(query: String = ""): JSONObject =
        JSONObject(
            mockMvc
                .perform(get("/chat$query").header("Authorization", "Bearer $humanToken"))
                .andExpect(status().isOk)
                .andReturn()
                .response
                .contentAsString
        )

    private fun membersOf(body: JSONObject, chatId: IdType): Map<IdType, JSONObject> {
        val chats = body.getJSONArray("chats")
        for (i in 0 until chats.length()) {
            val chat = chats.getJSONObject(i)
            if (chat.getLong("id") != chatId) continue
            val members = chat.getJSONArray("members")
            return (0 until members.length())
                .map { members.getJSONObject(it) }
                .associateBy { it.getLong("userId") }
        }
        error("chat $chatId not in the list")
    }

    /**
     * Not asking must change nothing: `isAgent` comes back null, not false. A client that read an
     * unanswered field as "not an agent" would draw every group as human-only, so keeping the two
     * apart is the whole reason the field is nullable.
     */
    @Test
    @Order(1)
    fun withoutTheFlagTheFieldIsNullRatherThanFalse() {
        val members = membersOf(listChats(), oneAgentChat)
        assertTrue(members.isNotEmpty(), "the chat must list its members either way")
        members.values.forEach { member ->
            assertTrue(
                member.isNull("isAgent"),
                "isAgent must stay unanswered unless the caller asked for it",
            )
        }
    }

    /** Asked for: exactly the members that are agents come back true, in the same response. */
    @Test
    @Order(2)
    fun askingReportsWhichMembersAreAgents() {
        val body = listChats("?queryIsMemberAgent=true")

        val one = membersOf(body, oneAgentChat)
        assertEquals(true, one[agentOneId]!!.getBoolean("isAgent"), "the agent must be flagged")
        assertEquals(false, one[humanId]!!.getBoolean("isAgent"), "a human must be flagged false")
        assertEquals(false, one[otherHumanId]!!.getBoolean("isAgent"))

        // Two agents: both true. The list then renders a member grid — that decision is the
        // client's, but it can only make it if the server reports both.
        val two = membersOf(body, twoAgentChat)
        assertEquals(true, two[agentOneId]!!.getBoolean("isAgent"))
        assertEquals(true, two[agentTwoId]!!.getBoolean("isAgent"))

        // And a group with no agents says so explicitly, which is not the same as saying nothing.
        val humans = membersOf(body, humansOnlyChat)
        humans.values.forEach { assertEquals(false, it.getBoolean("isAgent")) }
    }
}
