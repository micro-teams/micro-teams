/*
 *  Description: What must be true before a second network path is added.
 *
 *               Two properties, both of which fail in ways that look like something else. A line
 *               whose origin is not allowed by CORS shows up as "the app intermittently cannot
 *               reach the backend" — intermittently, because it depends on which line won the race.
 *               A malformed line url is worse: the client rejects the registry, silently keeps the
 *               same-origin line, and multi-line simply never turns on while every dashboard says
 *               it is configured.
 *
 *               So: the CORS allowlist is derived from the registry rather than repeated beside it,
 *               and a malformed registry stops the application at startup, where the operator is
 *               still looking at the change they just made.
 *
 *  Author(s):
 *      agent3
 */

package app.microteams.api

import app.microteams.transport.LineRegistryProperties
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
import org.springframework.test.context.TestPropertySource
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.*

@SpringBootTest
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@AutoConfigureMockMvc
@TestPropertySource(
    properties =
        [
            // The public origin, named where a same-origin line cannot name it. Production found
            // this the hard way: without it, a page on this origin racing a request to another line
            // sends an Origin nothing here recognises, and its own CORS refuses every request.
            "application.cors-origin=https://microteams.example.app",
            "application.multipath.lines[0].id=origin",
            "application.multipath.lines[0].url=",
            "application.multipath.lines[1].id=cf",
            "application.multipath.lines[1].url=https://cf.mt.example.app",
            "application.multipath.lines[1].transport=wss",
            "application.multipath.lines[1].weight=90",
        ]
)
class MultiLineConfigTest @Autowired constructor(private val mockMvc: MockMvc) {

    @Test
    fun theRegistryServesEveryConfiguredLine() {
        mockMvc
            .perform(get("/lines"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.lines.length()").value(2))
            .andExpect(jsonPath("$.lines[1].id").value("cf"))
            .andExpect(jsonPath("$.lines[1].url").value("https://cf.mt.example.app"))
            .andExpect(jsonPath("$.lines[1].transport").value("wss"))
    }

    /**
     * A page loaded over one line, calling another. This is the request that does not exist today
     * and will be most of the traffic the day a second line is added.
     */
    @Test
    fun aRequestFromAnotherLinesOriginIsAllowed() {
        mockMvc
            .perform(
                options("/chat")
                    .header("Origin", "https://cf.mt.example.app")
                    .header("Access-Control-Request-Method", "GET")
            )
            .andExpect(status().isOk)
            .andExpect(header().string("Access-Control-Allow-Origin", "https://cf.mt.example.app"))
            .andExpect(header().string("Access-Control-Allow-Credentials", "true"))
    }

    /**
     * The transport label a client is given has to be one it can actually dial.
     *
     * It was a free-form diagnostic string until MultiPath 0.2.0 and is now the encapsulation:
     * "wss" is a WebSocket upgrade through the proxy, "tcp"/"tls" a port that speaks the substrate
     * directly. A value outside that vocabulary — "cloudflare", "direct", "same-origin", all of
     * which were once perfectly good labels here — means every client refuses to dial the line, and
     * refuses silently, because a line that cannot be dialled is simply one the client does not
     * have. The registry would look right in every dashboard while nothing could connect over it.
     */
    @Test
    fun everyLineNamesATransportAClientCanDial() {
        val dialable = setOf("ws", "wss", "tcp", "tls")
        val body =
            mockMvc
                .perform(get("/lines"))
                .andExpect(status().isOk)
                .andReturn()
                .response
                .contentAsString
        val transports =
            Regex("\"transport\":\"([^\"]*)\"").findAll(body).map { it.groupValues[1] }.toList()
        assertTrue(transports.isNotEmpty(), "the registry named no transport at all: $body")
        transports.forEach {
            assertTrue(
                it in dialable,
                "line transport \"$it\" is not one a client can dial: $dialable",
            )
        }
    }

    /**
     * The request that broke in production: the browser loaded the page over the same-origin line
     * and raced this one to another line, so the Origin is the page's and the host is the other
     * line's. Nothing derives the first from the second — it has to have been configured.
     */
    @Test
    fun aRequestFromThePagesOwnOriginIsAllowedOverAnotherLine() {
        mockMvc
            .perform(
                options("/chat")
                    .header("Origin", "https://microteams.example.app")
                    .header("X-Forwarded-Host", "cf.mt.example.app")
                    .header("X-Forwarded-Proto", "https")
                    .header("Access-Control-Request-Method", "GET")
            )
            .andExpect(status().isOk)
            .andExpect(
                header().string("Access-Control-Allow-Origin", "https://microteams.example.app")
            )
    }

    /**
     * And the same for an ordinary GET. The filter refuses a disallowed origin on a simple request
     * too, not only on a preflight — which is why the broken deployment's probe eventually reported
     * the line as down rather than leaving it looking healthy.
     */
    @Test
    fun theProbeIsNotExemptFromCors() {
        mockMvc
            .perform(get("/probe").header("Origin", "https://not-our-line.example"))
            .andExpect(status().isForbidden)

        mockMvc
            .perform(get("/probe").header("Origin", "https://microteams.example.app"))
            .andExpect(status().isNoContent)
    }

    /** And the converse, or the allowlist would not be an allowlist. */
    @Test
    fun anUnknownOriginIsStillRefused() {
        mockMvc
            .perform(
                options("/chat")
                    .header("Origin", "https://not-our-line.example")
                    .header("Access-Control-Request-Method", "GET")
            )
            .andExpect(status().isForbidden)
    }

    @Test
    fun aMalformedRegistryStopsTheApplication() {
        val withPath =
            LineRegistryProperties(
                listOf(LineRegistryProperties.Line(id = "cf", url = "https://cf.example/api"))
            )
        val duplicate =
            LineRegistryProperties(
                listOf(
                    LineRegistryProperties.Line(id = "cf", url = "https://a.example"),
                    LineRegistryProperties.Line(id = "cf", url = "https://b.example"),
                )
            )

        assertEquals(
            true,
            assertThrows(IllegalArgumentException::class.java) { withPath.validate() }
                .message
                ?.contains("no trailing slash"),
        )
        assertEquals(
            true,
            assertThrows(IllegalArgumentException::class.java) { duplicate.validate() }
                .message
                ?.contains("duplicate"),
        )
    }
}
