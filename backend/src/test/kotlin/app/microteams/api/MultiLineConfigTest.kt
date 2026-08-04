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
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
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
            "application.multipath.lines[0].id=origin",
            "application.multipath.lines[0].url=",
            "application.multipath.lines[1].id=cf",
            "application.multipath.lines[1].url=https://cf.mt.example.app",
            "application.multipath.lines[1].transport=cloudflare",
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
            .andExpect(jsonPath("$.lines[1].transport").value("cloudflare"))
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

    /** The header the transport adds to every write must survive preflight, credentials and all. */
    @Test
    fun theIdempotencyKeyHeaderSurvivesPreflight() {
        val allowed =
            mockMvc
                .perform(
                    options("/chat")
                        .header("Origin", "https://cf.mt.example.app")
                        .header("Access-Control-Request-Method", "POST")
                        .header("Access-Control-Request-Headers", "Idempotency-Key")
                )
                .andExpect(status().isOk)
                .andReturn()
                .response
                .getHeader("Access-Control-Allow-Headers")
        assertTrue(
            allowed != null && allowed.contains("Idempotency-Key", ignoreCase = true),
            "preflight did not allow Idempotency-Key, it answered: $allowed",
        )
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
