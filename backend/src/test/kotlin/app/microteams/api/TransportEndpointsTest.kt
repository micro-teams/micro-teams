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
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
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
}
