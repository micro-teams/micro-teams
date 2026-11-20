/*
 *  Description: Which browser origins the backend admits.
 *
 *               Every page is served from the deployment's own origin, which the backend learns
 *               per request from the forwarded headers nginx sets; application.cors-origin may add
 *               more. Anything else is refused, or the allowlist would not be an allowlist. The
 *               cases are preflights for a real endpoint, because that is what a browser sends
 *               before a credentialed request.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 */

package app.microteams.api

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
@TestPropertySource(properties = ["application.cors-origin=https://teams.example.app"])
class CorsTest @Autowired constructor(private val mockMvc: MockMvc) {

    /** A page served by this deployment, behind the proxy that terminated its TLS. */
    @Test
    fun thePagesOwnForwardedOriginIsAllowed() {
        mockMvc
            .perform(
                options("/chat")
                    .header("Origin", "https://mt.example.app")
                    .header("X-Forwarded-Host", "mt.example.app")
                    .header("X-Forwarded-Proto", "https")
                    .header("Access-Control-Request-Method", "GET"),
            )
            .andExpect(status().isOk)
            .andExpect(header().string("Access-Control-Allow-Origin", "https://mt.example.app"))
            .andExpect(header().string("Access-Control-Allow-Credentials", "true"))
    }

    @Test
    fun aConfiguredOriginIsAllowed() {
        mockMvc
            .perform(
                options("/chat")
                    .header("Origin", "https://teams.example.app")
                    .header("X-Forwarded-Host", "mt.example.app")
                    .header("X-Forwarded-Proto", "https")
                    .header("Access-Control-Request-Method", "GET"),
            )
            .andExpect(status().isOk)
            .andExpect(header().string("Access-Control-Allow-Origin", "https://teams.example.app"))
    }

    @Test
    fun anUnknownOriginIsRefused() {
        mockMvc
            .perform(
                options("/chat")
                    .header("Origin", "https://not-ours.example")
                    .header("X-Forwarded-Host", "mt.example.app")
                    .header("X-Forwarded-Proto", "https")
                    .header("Access-Control-Request-Method", "GET"),
            )
            .andExpect(status().isForbidden)
    }
}
