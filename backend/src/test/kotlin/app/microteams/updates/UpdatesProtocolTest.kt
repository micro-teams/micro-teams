/*
 *  Description: End-to-end test for the updates socket: a real WebSocket client against a running
 *               port, a real HTTP POST of a real message, and the assertion that the event arrives.
 *
 *               Two of these are the kind of test this design document asks for by name. "A member
 *               is told" is the happy path. "A non-member is refused, out loud" is the one that
 *               matters more: a silent refusal looks exactly like a quiet topic, and a frontend
 *               waiting on a subscription it never got would sit there forever showing stale data
 *               while everything appeared healthy.
 *
 *               Reverse-verified by hand before committing: with the publish in ChatTopics removed,
 *               `a member is told when a message lands` fails on the receive timeout. A push test
 *               that cannot go red is the same thing as no test.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.updates

import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.util.UUID
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import org.json.JSONObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.rucca.cheese.common.persistent.IdType
import org.rucca.cheese.utils.UserCreatorService
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.web.socket.TextMessage
import org.springframework.web.socket.WebSocketSession
import org.springframework.web.socket.client.standard.StandardWebSocketClient
import org.springframework.web.socket.handler.TextWebSocketHandler

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class UpdatesProtocolTest
@Autowired
constructor(private val userCreatorService: UserCreatorService) {

    @LocalServerPort private var port: Int = 0

    private lateinit var memberToken: String
    private lateinit var outsiderToken: String
    private var memberId: IdType = -1
    private var otherMemberId: IdType = -1
    private var threadId: IdType = -1
    private val http: HttpClient = HttpClient.newHttpClient()

    @BeforeAll
    fun prepare() {
        val member = userCreatorService.createUser()
        memberToken = userCreatorService.login(member.username, member.password)
        memberId = member.userId
        val other = userCreatorService.createUser()
        otherMemberId = other.userId
        val outsider = userCreatorService.createUser()
        outsiderToken = userCreatorService.login(outsider.username, outsider.password)
        threadId = createChat(listOf(otherMemberId))
    }

    /** The whole point: someone in the group is told, quickly, that the thread moved. */
    @Test
    fun `a member is told when a message lands`() {
        val client = connect(memberToken)
        try {
            client.send("""{"t":"sub","topics":["thread:$threadId"]}""")
            val ack = client.next()
            assertEquals("ack", ack.getString("t"))
            assertEquals("thread:$threadId", ack.getJSONArray("granted").getString(0))

            val postedId = postMessage("hello from the test")

            val event = client.next()
            assertEquals("event", event.getString("t"))
            assertEquals("thread:$threadId", event.getString("topic"))
            assertEquals(UpdateKind.MESSAGE_CREATED, event.getString("kind"))
            // The cursor IS the message id — the same number the frontend pages with.
            assertEquals(postedId, event.getLong("seq"))
        } finally {
            client.close()
        }
    }

    /**
     * A refusal must be said out loud. If the server simply ignored the request, the client could
     * not tell "you may not have this" from "nothing has happened yet".
     */
    @Test
    fun `an outsider is refused, and told so`() {
        val client = connect(outsiderToken)
        try {
            client.send("""{"t":"sub","topics":["thread:$threadId"]}""")
            val ack = client.next()
            assertEquals("ack", ack.getString("t"))
            assertEquals(0, ack.getJSONArray("granted").length())
            assertEquals("thread:$threadId", ack.getJSONArray("refused").getString(0))
        } finally {
            client.close()
        }
    }

    @Test
    fun `a nonsense topic is refused rather than crashing the connection`() {
        val client = connect(memberToken)
        try {
            client.send("""{"t":"sub","topics":["not-a-topic","thread:not-a-number"]}""")
            val ack = client.next()
            assertEquals(2, ack.getJSONArray("refused").length())
            // Still usable afterwards.
            client.send("""{"t":"ping"}""")
            assertEquals("pong", client.next().getString("t"))
        } finally {
            client.close()
        }
    }

    /** An unknown frame type must be ignored in silence, not answered and not fatal. */
    @Test
    fun `an unknown frame is ignored and the connection survives`() {
        val client = connect(memberToken)
        try {
            client.send("""{"t":"from-the-future","wat":1}""")
            client.send("""{"t":"ping"}""")
            assertEquals("pong", client.next().getString("t"))
        } finally {
            client.close()
        }
    }

    @Test
    fun `a handshake without a token is rejected`() {
        val failed =
            try {
                StandardWebSocketClient()
                    .execute(TextWebSocketHandler(), "ws://localhost:$port/mt/updates")
                    .get(5, TimeUnit.SECONDS)
                false
            } catch (e: Exception) {
                true
            }
        assertTrue(failed, "an unauthenticated updates socket must not be accepted")
    }

    // -- plumbing ----------------------------------------------------------

    private inner class Client(
        val session: WebSocketSession,
        val inbox: LinkedBlockingQueue<String>,
    ) {
        fun send(json: String) = session.sendMessage(TextMessage(json))

        fun next(): JSONObject {
            val raw = inbox.poll(5, TimeUnit.SECONDS)
            assertNotNull(raw, "expected a frame from the updates socket")
            return JSONObject(raw)
        }

        fun close() = session.close()
    }

    private fun connect(token: String): Client {
        val inbox = LinkedBlockingQueue<String>()
        val session =
            StandardWebSocketClient()
                .execute(
                    object : TextWebSocketHandler() {
                        override fun handleTextMessage(
                            session: WebSocketSession,
                            message: TextMessage,
                        ) {
                            inbox.put(message.payload)
                        }
                    },
                    "ws://localhost:$port/mt/updates?token=$token",
                )
                .get(5, TimeUnit.SECONDS)
        return Client(session, inbox)
    }

    private fun createChat(memberIds: List<IdType>): IdType {
        val body =
            """{"title":"updates ${UUID.randomUUID().toString().take(6)}","memberIds":${
                memberIds.joinToString(",", "[", "]")
            }}"""
        return JSONObject(post("/chat", body, memberToken)).getLong("id")
    }

    private fun postMessage(content: String): Long =
        JSONObject(post("/chat/$threadId/messages", """{"content":"$content"}""", memberToken))
            .getLong("id")

    private fun post(path: String, body: String, token: String): String {
        val response =
            http.send(
                HttpRequest.newBuilder(URI("http://localhost:$port$path"))
                    .header("Authorization", "Bearer $token")
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .build(),
                HttpResponse.BodyHandlers.ofString(),
            )
        assertTrue(
            response.statusCode() in 200..299,
            "POST $path failed: ${response.statusCode()} ${response.body()}",
        )
        return response.body()
    }
}
