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
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package org.rucca.cheese.common.config

import jakarta.servlet.http.HttpServletRequest
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.web.cors.CorsConfiguration
import org.springframework.web.cors.CorsConfigurationSource
import org.springframework.web.filter.CorsFilter

@Configuration
class WebConfig(private val applicationConfig: ApplicationConfig) {
    @Bean
    fun corsFilter(): CorsFilter {
        val configured =
            applicationConfig.corsOrigin.split(",").map { it.trim() }.filter { it.isNotEmpty() }
        val source = CorsConfigurationSource { request: HttpServletRequest ->
            val proto = request.getHeader("X-Forwarded-Proto") ?: request.scheme
            val host = request.getHeader("X-Forwarded-Host") ?: request.getHeader("Host")
            val ownOrigin = if (!host.isNullOrBlank()) "$proto://$host" else null
            CorsConfiguration().apply {
                // allowedOriginPatterns (not allowedOrigins) so it coexists with allowCredentials
                // and
                // still accepts any patterns in application.cors-origin.
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
