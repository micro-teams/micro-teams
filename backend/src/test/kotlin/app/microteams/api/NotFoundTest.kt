/*
 *  Description: Integration test pinning that an unknown URL is a 404, not a 500.
 *               A request matching no controller route and no static resource used
 *               to fall through GlobalErrorHandler's catch-all and come back as a
 *               500 with a full ERROR stacktrace; it must now return the 404
 *               NotFoundError contract.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.api

import kotlin.math.floor
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
class NotFoundTest @Autowired constructor(private val mockMvc: MockMvc) {

    private val missingPath = "/no-such-endpoint-${floor(Math.random() * 1e10).toLong()}"

    @Test
    fun unknownPathReturns404NotFoundContract() {
        mockMvc
            .perform(get(missingPath))
            .andExpect(status().isNotFound)
            .andExpect(jsonPath("$.code").value(404))
            .andExpect(jsonPath("$.error.name").value("EndpointNotFoundError"))
    }

    @Test
    fun unknownPathIsNotAffectedByHttpMethod() {
        mockMvc.perform(post(missingPath)).andExpect(status().isNotFound)
    }
}
