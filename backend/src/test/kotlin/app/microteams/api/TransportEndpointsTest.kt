/*
 *  Description: The two transport endpoints, and the property that matters most about both: they
 *               answer without a credential.
 *
 *               A client asks them before it has a session — it cannot log in until it can reach
 *               the server, and it cannot choose a route until it knows the routes. If either of
 *               these ever starts requiring authentication, every line would look dead to a logged
 *               out browser and the app would rank a healthy deployment as entirely down. That is
 *               the kind of regression a guard added "for consistency" causes, so it is pinned here.
 *
 *  Author(s):
 *      agent3
 */

package app.microteams.api

import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.*

@SpringBootTest
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@AutoConfigureMockMvc
class TransportEndpointsTest @Autowired constructor(private val mockMvc: MockMvc) {

    @Test
    fun probeAnswersWithoutACredential() {
        mockMvc.perform(get("/probe")).andExpect(status().isNoContent)
    }

    /** No body, deliberately: it is called on every line every few seconds. */
    @Test
    fun probeReturnsNothingToParse() {
        mockMvc.perform(get("/probe")).andExpect(content().string(""))
    }

    /**
     * With nothing configured the answer is one same-origin line, which is the truth for a
     * single-route deployment rather than a placeholder for one.
     */
    @Test
    fun linesDefaultsToTheOriginTheClientAlreadyReached() {
        mockMvc
            .perform(get("/lines"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.lines.length()").value(1))
            .andExpect(jsonPath("$.lines[0].id").value("origin"))
            .andExpect(jsonPath("$.lines[0].url").value(""))
    }

    /**
     * The scheme a client is told to dial with has to match the one it actually reached us over.
     *
     * This is a silent failure in both directions and that is the whole reason it is pinned. Hand a
     * plain-HTTP deployment "wss" and every client fails to dial, falls back to sending directly,
     * and works — so the transport is switched off and nothing anywhere says so. Hand an HTTPS
     * deployment "ws" and the browser refuses the connection outright as mixed content.
     *
     * X-Forwarded-Proto is the authority because the proxy terminated the TLS; this application
     * only ever sees plain HTTP from it, so its own scheme would say "ws" on every production
     * deployment there is.
     */
    @Test
    fun aTlsClientIsToldToDialOverTls() {
        mockMvc
            .perform(get("/lines").header("X-Forwarded-Proto", "https"))
            .andExpect(jsonPath("$.lines[0].transport").value("wss"))
    }

    @Test
    fun aPlainHttpClientIsToldToDialPlainly() {
        mockMvc
            .perform(get("/lines").header("X-Forwarded-Proto", "http"))
            .andExpect(jsonPath("$.lines[0].transport").value("ws"))
    }

    /**
     * Nothing in front at all: the request's own scheme is the answer, which is the ordinary case
     * for anything talking to this process directly.
     *
     * Its own test rather than a third assertion inside one of the others, because what is read is
     * per-request state reached through a proxy — and two requests in one test method share enough
     * context that the second can be answered with the first one's header. That is not a
     * hypothetical: it is how this assertion first went green while being wrong.
     */
    @Test
    fun withNothingInFrontTheRequestsOwnSchemeIsUsed() {
        mockMvc.perform(get("/lines")).andExpect(jsonPath("$.lines[0].transport").value("ws"))
    }
}
