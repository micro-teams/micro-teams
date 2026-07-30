/*
 *  Description: Integration test for retry-safe posting: `clientToken` on POST /chat/{id}/messages.
 *
 *               A client that must not lose messages has to retry, and the case that makes retrying
 *               dangerous is invisible from the client's side: the request arrived and was stored,
 *               but the RESPONSE was lost. Retrying then duplicates the message. So the client names
 *               the message and the server honours the name — which is what these tests pin, along
 *               with the thing that must NOT be broken by it: two deliberate sends of the same words
 *               are still two messages.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.api

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
class MessageIdempotencyTest
@Autowired
constructor(private val mockMvc: MockMvc, private val userCreatorService: UserCreatorService) {
    private lateinit var token: String
    private var threadId: IdType = -1

    @BeforeAll
    fun prepare() {
        val user = userCreatorService.createUser()
        token = userCreatorService.login(user.username, user.password)
        val res =
            mockMvc
                .perform(
                    post("/chat")
                        .header("Authorization", "Bearer $token")
                        .contentType("application/json")
                        .content("""{"title":"retry safety"}""")
                )
                .andExpect(status().isCreated)
                .andReturn()
        threadId = JSONObject(res.response.contentAsString).getLong("id")
    }

    /** Named `send`, not `post`: a local `post` would shadow MockMvcRequestBuilders.post. */
    private fun send(content: String, clientToken: String? = null): JSONObject {
        val body =
            if (clientToken == null) """{"content":"$content"}"""
            else """{"content":"$content","clientToken":"$clientToken"}"""
        val res =
            mockMvc
                .perform(
                    post("/chat/$threadId/messages")
                        .header("Authorization", "Bearer $token")
                        .contentType("application/json")
                        .content(body)
                )
                .andExpect(status().isCreated)
                .andReturn()
        return JSONObject(res.response.contentAsString)
    }

    private fun messageCount(): Int =
        JSONObject(
                mockMvc
                    .perform(
                        get("/chat/$threadId/messages?page_size=100")
                            .header("Authorization", "Bearer $token")
                    )
                    .andExpect(status().isOk)
                    .andReturn()
                    .response
                    .contentAsString
            )
            .getJSONArray("messages")
            .length()

    /**
     * The whole point: the same token twice is one message, and the second call answers with the
     * message that already exists — so a client whose response was lost can simply ask again.
     */
    @Test
    @Order(1)
    fun theSameTokenTwiceIsOneMessage() {
        val before = messageCount()
        val clientToken = UUID.randomUUID().toString()

        val first = send("network died on the way back", clientToken)
        val second = send("network died on the way back", clientToken)

        assertEquals(first.getLong("id"), second.getLong("id"), "a retry must not create a second")
        assertEquals(clientToken, second.getString("clientToken"), "the token is echoed back")
        assertEquals(before + 1, messageCount(), "exactly one message was stored")
    }

    /**
     * And the thing that must not break: saying the same words twice on purpose is two messages.
     * Any content/time-based deduplication would swallow the second, which is why the client names
     * its messages instead.
     */
    @Test
    @Order(2)
    fun thesameContentUnderDifferentTokensIsTwoMessages() {
        val before = messageCount()
        val one = send("ok", UUID.randomUUID().toString())
        val two = send("ok", UUID.randomUUID().toString())

        assertNotEquals(one.getLong("id"), two.getLong("id"))
        assertEquals(before + 2, messageCount(), "both deliberate sends are kept")
    }

    /** A caller that never retries omits the token; nothing changes for it. */
    @Test
    @Order(3)
    fun withoutATokenNothingChanges() {
        val before = messageCount()
        val posted = send("no token here")
        assertEquals(before + 1, messageCount())
        assertEquals(false, posted.has("clientToken") && !posted.isNull("clientToken"))
    }
}
