/*
 *  Description: CORS configuration.
 *
 *               The whole stack is served behind a single origin (Cloudflare → the bundle's nginx →
 *               the services), so every browser request is really same-origin. The backend just
 *               can't *see* that behind the proxy — Spring compares the browser's Origin against its
 *               own internal host and, finding them different, treats a same-origin POST as a
 *               rejected cross-origin request ("Invalid CORS request").
 *
 *               Fix: derive our own public origin per request from the forwarded headers nginx sets
 *               (X-Forwarded-Proto/Host) and allow exactly that. It is same-origin, so credentials
 *               work (cheese-auth's refresh token is an httpOnly cookie), it needs no domain
 *               configured (works behind any domain), and it never falls back to "*", which would
 *               let any site issue credentialed requests. application.cors-origin may list any extra
 *               origins/patterns a non-default deployment needs.
 *
 *               WebConfig(applicationConfig).corsFilter() → the CorsFilter bean Spring applies to
 *               every request; it allows the request's own forwarded origin plus the configured
 *               ones, with credentials. Example: application.cors-origin=https://teams.example
 *               also admits pages served from that origin.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package org.rucca.cheese.common.config

import jakarta.servlet.http.HttpServletRequest
import org.slf4j.LoggerFactory
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.web.cors.CorsConfiguration
import org.springframework.web.cors.CorsConfigurationSource
import org.springframework.web.filter.CorsFilter

@Configuration
class WebConfig(private val applicationConfig: ApplicationConfig) {
    private val logger = LoggerFactory.getLogger(WebConfig::class.java)

    private fun configuredOrigins(): List<String> =
        applicationConfig.corsOrigin.split(",").map { it.trim() }.filter { it.isNotEmpty() }

    @Bean
    fun corsFilter(): CorsFilter {
        val configured = configuredOrigins()
        // Logged once, because "what does the server think it allows?" is the first question asked
        // when a browser request is refused.
        logger.info(
            "CORS: allowing configured={} plus each request's own forwarded origin",
            configured,
        )
        val source = CorsConfigurationSource { request: HttpServletRequest ->
            val proto = request.getHeader("X-Forwarded-Proto") ?: request.scheme
            val host = request.getHeader("X-Forwarded-Host") ?: request.getHeader("Host")
            val ownOrigin = if (!host.isNullOrBlank()) "$proto://$host" else null
            CorsConfiguration().apply {
                // allowedOriginPatterns (not allowedOrigins) so it coexists with allowCredentials
                // and still accepts any patterns in application.cors-origin.
                allowedOriginPatterns = (configured + listOfNotNull(ownOrigin)).distinct()
                allowedMethods = listOf("*")
                allowedHeaders = listOf("*")
                allowCredentials = true
                maxAge = 3600
            }
        }
        return CorsFilter(source)
    }
}
