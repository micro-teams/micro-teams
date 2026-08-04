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
 *               Multi-line: every origin in application.multipath.lines is allowed too. A browser
 *               loaded over one line and racing a request to another sends the first as Origin, and
 *               the derived own-origin is the second — so without this, adding a line silently
 *               breaks every request that line wins.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package org.rucca.cheese.common.config

import app.microteams.transport.LineRegistryProperties
import jakarta.servlet.http.HttpServletRequest
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.web.cors.CorsConfiguration
import org.springframework.web.cors.CorsConfigurationSource
import org.springframework.web.filter.CorsFilter

@Configuration
class WebConfig(
    private val applicationConfig: ApplicationConfig,
    private val lines: LineRegistryProperties,
) {
    @Bean
    fun corsFilter(): CorsFilter {
        val configured =
            applicationConfig.corsOrigin.split(",").map { it.trim() }.filter { it.isNotEmpty() }
        // Every configured MultiPath line is an allowed origin, derived rather than repeated.
        //
        // The per-request origin below is the line the request was ADDRESSED TO, not the origin the
        // page came from — with one line those are the same thing, which is why this was never
        // needed before. With two, a page served over line A calling line B sends `Origin: A` while
        // B allows only B, and the request is refused. Deriving the list from the registry means
        // adding a line cannot forget to add its origin here, and the failure it prevents is a
        // miserable one to diagnose: the app works, then intermittently cannot reach the backend
        // depending on which line won.
        val lineOrigins = lines.origins()
        val source = CorsConfigurationSource { request: HttpServletRequest ->
            val proto = request.getHeader("X-Forwarded-Proto") ?: request.scheme
            val host = request.getHeader("X-Forwarded-Host") ?: request.getHeader("Host")
            val ownOrigin = if (!host.isNullOrBlank()) "$proto://$host" else null
            CorsConfiguration().apply {
                // allowedOriginPatterns (not allowedOrigins) so it coexists with allowCredentials
                // and
                // still accepts any patterns in application.cors-origin.
                allowedOriginPatterns =
                    (configured + lineOrigins + listOfNotNull(ownOrigin)).distinct()
                allowedMethods = listOf("*")
                allowedHeaders = listOf("*")
                allowCredentials = true
                maxAge = 3600
            }
        }
        return CorsFilter(source)
    }
}
