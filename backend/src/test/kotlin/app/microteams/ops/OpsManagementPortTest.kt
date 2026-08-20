/*
 *  Description: The operator surface as it is actually deployed: on its own port, behind its own
 *               token, with a real HTTP client — because the thing being asserted is which port
 *               serves what, and a MockMvc call cannot tell two ports apart.
 *
 *               The update case tested here is the offline one, and that is on purpose: it is the
 *               case an operator will hit most, and the one where the wrong behaviour (quietly
 *               queueing) would be least visible.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.ops

import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.util.UUID
import org.json.JSONArray
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalManagementPort
import org.springframework.boot.test.web.server.LocalServerPort

private const val TOKEN = "an-operator-token-for-the-test"

@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties =
        [
            "management.server.port=0",
            "management.endpoints.web.exposure.include=health",
            "application.ops.token=$TOKEN",
        ],
)
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class OpsManagementPortTest
@Autowired
constructor(private val machineRepository: app.microteams.machine.enrollment.MachineRepository) {

    @LocalServerPort private var appPort: Int = 0
    @LocalManagementPort private var opsPort: Int = 0

    private val http: HttpClient = HttpClient.newHttpClient()

    @Test
    fun `an operator with the token can list machines`() {
        val id = "m" + UUID.randomUUID().toString().replace("-", "").take(12)
        machineRepository.save(
            app.microteams.machine.enrollment.Machine(
                machineId = id,
                name = "test box",
                token = UUID.randomUUID().toString(),
            )
        )

        val response = get(opsPort, "/ops/machines", TOKEN)
        assertEquals(200, response.statusCode())
        val body = JSONArray(response.body())
        val mine =
            (0 until body.length())
                .map { body.getJSONObject(it) }
                .first { it.getString("id") == id }
        assertTrue(
            mine.isNull("build"),
            "a machine that never reported must read as unknown, not old",
        )
        assertEquals(false, mine.getBoolean("online"))
    }

    @Test
    fun `no token is refused`() {
        assertEquals(401, get(opsPort, "/ops/machines", null).statusCode())
    }

    @Test
    fun `the wrong token is refused`() {
        assertEquals(401, get(opsPort, "/ops/machines", "not-the-token").statusCode())
    }

    /** The claim that has to hold even when the surface exists: it is not on the public port. */
    @Test
    fun `the same request to the application port finds nothing`() {
        assertEquals(404, get(appPort, "/ops/machines", TOKEN).statusCode())
    }

    /**
     * An offline machine is refused outright. Queueing would fire the update at some unpredictable
     * later moment, long after whoever asked for it stopped watching.
     */
    @Test
    fun `updating an offline machine is refused rather than queued`() {
        val id = "m" + UUID.randomUUID().toString().replace("-", "").take(12)
        machineRepository.save(
            app.microteams.machine.enrollment.Machine(
                machineId = id,
                name = "offline box",
                token = UUID.randomUUID().toString(),
            )
        )

        val response = post(opsPort, "/ops/machines/$id/update", TOKEN)
        assertEquals(409, response.statusCode())
        assertTrue(response.body().contains("offline"))
    }

    @Test
    fun `updating a machine that does not exist is a 404`() {
        assertEquals(404, post(opsPort, "/ops/machines/nope/update", TOKEN).statusCode())
    }

    private fun get(port: Int, path: String, token: String?): HttpResponse<String> =
        send(HttpRequest.newBuilder(URI("http://localhost:$port$path")).GET(), token)

    private fun post(port: Int, path: String, token: String?): HttpResponse<String> =
        send(
            HttpRequest.newBuilder(URI("http://localhost:$port$path"))
                .POST(HttpRequest.BodyPublishers.noBody()),
            token,
        )

    private fun send(builder: HttpRequest.Builder, token: String?): HttpResponse<String> {
        if (token != null) builder.header("X-Ops-Token", token)
        return http.send(builder.build(), HttpResponse.BodyHandlers.ofString())
    }
}
