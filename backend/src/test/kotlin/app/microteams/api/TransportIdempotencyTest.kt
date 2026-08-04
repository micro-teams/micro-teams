/*
 *  Description: Integration test for the MultiPath idempotency filter, as installed here.
 *
 *               The filter has its own tests in its own repository, including the concurrency one
 *               that matters. What those cannot show is that it is actually *wired into this
 *               application* — that adding the dependency was really the whole installation, and
 *               that nothing in our filter chain or our error handling gets in front of it. That is
 *               what this pins, and it is worth pinning because the failure mode is silent: writes
 *               would simply start executing twice, with no error anywhere.
 *
 *               Distinct from MessageIdempotencyTest. That one is about a *business* identity: a
 *               client naming its message so a lost response can be re-sent, which only chat has.
 *               This one is about the transport: any non-idempotent write, named by a header the
 *               client never had to think about, so that a request racing over two network paths
 *               takes effect once. Both exist; neither replaces the other.
 *
 *  Author(s):
 *      agent3
 */

package app.microteams.api

import java.util.UUID
import org.json.JSONObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
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
class TransportIdempotencyTest
@Autowired
constructor(private val mockMvc: MockMvc, private val userCreatorService: UserCreatorService) {
    private lateinit var token: String

    @BeforeAll
    fun prepare() {
        val user = userCreatorService.createUser()
        token = userCreatorService.login(user.username, user.password)
    }

    private fun createThread(title: String, key: String?) =
        mockMvc.perform(
            post("/chat")
                .header("Authorization", "Bearer $token")
                .apply { if (key != null) header("Idempotency-Key", key) }
                .contentType("application/json")
                .content("""{"title":"$title"}""")
        )

    private fun threadCount(): Int =
        JSONObject(
                mockMvc
                    .perform(get("/chat?page_size=100").header("Authorization", "Bearer $token"))
                    .andExpect(status().isOk)
                    .andReturn()
                    .response
                    .contentAsString
            )
            .getJSONArray("chats")
            .length()

    /**
     * The claim, on an endpoint with no idempotency of its own: the same key twice creates one
     * thread, and the duplicate is answered with a byte-identical copy of the first answer rather
     * than an error. Replay, not reject — the duplicate is a real client really waiting, and
     * telling it "duplicate" would report a write that succeeded as failed.
     */
    @Test
    fun theSameKeyTwiceCreatesOneThread() {
        val before = threadCount()
        val key = UUID.randomUUID().toString()

        val first =
            createThread("raced over two lines", key).andExpect(status().isCreated).andReturn()
        val second =
            createThread("raced over two lines", key).andExpect(status().isCreated).andReturn()

        assertEquals(
            JSONObject(first.response.contentAsString).getLong("id"),
            JSONObject(second.response.contentAsString).getLong("id"),
            "the second arrival must be replayed, not executed",
        )
        assertEquals("true", second.response.getHeader("Idempotency-Replayed"))
        assertEquals(before + 1, threadCount(), "exactly one thread was created")
    }

    /**
     * And the property that must not be sacrificed to it: two deliberate creations are two threads.
     * A client that means to do the same thing twice sends two keys, and both execute.
     */
    @Test
    fun differentKeysAreDifferentWrites() {
        val before = threadCount()

        val one = createThread("same words", UUID.randomUUID().toString()).andReturn()
        val two = createThread("same words", UUID.randomUUID().toString()).andReturn()

        assertNotEquals(
            JSONObject(one.response.contentAsString).getLong("id"),
            JSONObject(two.response.contentAsString).getLong("id"),
        )
        assertEquals(before + 2, threadCount())
    }

    /**
     * A write with no key is untouched. Every client that predates MultiPath sends none, and the
     * connector's own calls may not either — none of them may start failing because a filter was
     * added.
     */
    @Test
    fun aWriteWithoutAKeyIsUnaffected() {
        val before = threadCount()

        createThread("no key at all", null).andExpect(status().isCreated)
        createThread("no key at all", null).andExpect(status().isCreated)

        assertEquals(before + 2, threadCount(), "both went through")
    }
}
