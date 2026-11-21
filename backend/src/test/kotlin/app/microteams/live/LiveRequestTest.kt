/*
 *  Description: Live requests answer again whenever their answer would differ, and their last
 *               answer is always what a plain request answers.
 *
 *               The second test is the property the whole mechanism is for: after a random sequence
 *               of writes by two people, every subscription's last pushed result equals a fresh
 *               plain GET of the same path. It does not care how a change reached the hub (the
 *               table trigger, NOTIFY, the rerun), only that nothing was missed and nothing extra
 *               is left behind.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.live

import java.net.URI
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import kotlin.random.Random
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.rucca.cheese.utils.UserCreatorService
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.web.socket.TextMessage
import org.springframework.web.socket.WebSocketSession
import org.springframework.web.socket.client.standard.StandardWebSocketClient
import org.springframework.web.socket.handler.TextWebSocketHandler
import tools.jackson.databind.JsonNode
import tools.jackson.databind.ObjectMapper

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class LiveRequestTest
@Autowired
constructor(
    private val mockMvc: MockMvc,
    private val userCreatorService: UserCreatorService,
    private val objectMapper: ObjectMapper,
) {
    @LocalServerPort private var port: Int = 0

    private lateinit var tokenA: String
    private lateinit var tokenB: String
    private var userB: Long = 0

    /** One live socket: the latest result of each subscription, and when anything last arrived. */
    private inner class Live(token: String) : TextWebSocketHandler() {
        val latest = ConcurrentHashMap<String, JsonNode>()
        @Volatile var lastFrameAt = System.currentTimeMillis()
        val session: WebSocketSession =
            StandardWebSocketClient()
                .execute(this, null, URI("ws://localhost:$port/live?token=$token"))
                .get(5, TimeUnit.SECONDS)

        override fun handleTextMessage(session: WebSocketSession, message: TextMessage) {
            val frame = objectMapper.readTree(message.payload)
            if (frame["t"].asText() == "result") latest[frame["id"].asText()] = frame
            lastFrameAt = System.currentTimeMillis()
        }

        fun get(id: String, path: String) {
            synchronized(session) {
                session.sendMessage(TextMessage("""{"t":"get","id":"$id","path":"$path"}"""))
            }
        }

        /** Waits until a result for [id] satisfies [ok]. */
        fun await(id: String, ok: (JsonNode) -> Boolean): JsonNode {
            val until = System.currentTimeMillis() + 10_000
            while (System.currentTimeMillis() < until) {
                latest[id]?.let { if (ok(it)) return it }
                Thread.sleep(20)
            }
            error("no matching result for $id; last: ${latest[id]}")
        }

        /** Waits until nothing has arrived for a while: every rerun the writes caused is done. */
        fun settle() {
            val until = System.currentTimeMillis() + 10_000
            while (
                System.currentTimeMillis() < until && System.currentTimeMillis() - lastFrameAt < 600
            ) Thread.sleep(50)
            Thread.sleep(50)
        }
    }

    @BeforeAll
    fun prepare() {
        val a = userCreatorService.createUser()
        val b = userCreatorService.createUser()
        tokenA = userCreatorService.login(a.username, a.password)
        tokenB = userCreatorService.login(b.username, b.password)
        userB = b.userId
    }

    private fun plain(token: String, path: String): JsonNode =
        objectMapper.readTree(
            mockMvc
                .perform(get(path).header("Authorization", "Bearer $token"))
                .andReturn()
                .response
                .contentAsString,
        )

    private fun write(token: String, path: String, body: String): JsonNode =
        objectMapper.readTree(
            mockMvc
                .perform(
                    post(path)
                        .header("Authorization", "Bearer $token")
                        .contentType("application/json")
                        .content(body),
                )
                .andReturn()
                .response
                .contentAsString,
        )

    @Test
    fun aSubscriptionIsAnsweredAgainWhenItsAnswerChanges() {
        val live = Live(tokenA)
        live.get("chats", "/chat")
        val first = live.await("chats") { it["status"].asInt() == 200 }
        val before = first["body"]["chats"].size()

        write(tokenA, "/chat", """{"title":"live one","memberIds":[$userB]}""")

        live.await("chats") { it["body"]["chats"].size() == before + 1 }
        live.session.close()
    }

    @Test
    fun afterRandomWritesEverySubscriptionEqualsAPlainRequest() {
        val random = Random(20261121)
        val chat =
            write(tokenA, "/chat", """{"title":"seed","memberIds":[$userB]}""")["id"].asLong()
        val threads = mutableListOf(chat)
        val a = Live(tokenA)
        val b = Live(tokenB)
        val subs =
            listOf(
                Triple(a, tokenA, "/chat"),
                Triple(b, tokenB, "/chat"),
                Triple(a, tokenA, "/chat/$chat/messages"),
                Triple(b, tokenB, "/chat/$chat/members"),
            )
        subs.forEachIndexed { i, (live, _, path) -> live.get("s$i", path) }
        subs.forEachIndexed { i, (live, _, _) -> live.await("s$i") { true } }

        repeat(30) { step ->
            val thread = threads[random.nextInt(threads.size)]
            when (random.nextInt(4)) {
                0 ->
                    threads +=
                        write(tokenA, "/chat", """{"title":"t$step","memberIds":[$userB]}""")["id"]
                            .asLong()
                1 -> write(tokenA, "/chat/$thread/messages", """{"content":"a$step"}""")
                2 -> write(tokenB, "/chat/$thread/messages", """{"content":"b$step"}""")
                else ->
                    mockMvc.perform(
                        patch("/chat/$thread")
                            .header("Authorization", "Bearer $tokenA")
                            .contentType("application/json")
                            .content("""{"title":"renamed $step"}"""),
                    )
            }
            a.settle()
            b.settle()
            subs.forEachIndexed { i, (live, token, path) ->
                assertEquals(plain(token, path), live.latest["s$i"]!!["body"], "step $step, $path")
            }
        }
        a.session.close()
        b.session.close()
    }
}
