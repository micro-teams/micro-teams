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
 *               That leaves one origin the deployment cannot derive: its own public domain, when
 *               the page is served over the same-origin line (url ""). That line contributes no
 *               origin — it means "wherever the client came from" — so a page on microteams.app
 *               racing a request to another line sent an Origin nothing here had ever been told
 *               about, and every credentialed request over that line was refused. The probe was not
 *               exempt either: the filter refuses a disallowed origin on a simple GET too, so the
 *               line eventually went down rather than looking healthy. See requireThePageOriginIsNameable.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package org.rucca.cheese.common.config

import app.microteams.transport.LineRegistryProperties
import jakarta.annotation.PostConstruct
import jakarta.servlet.http.HttpServletRequest
import org.slf4j.LoggerFactory
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
    private val logger = LoggerFactory.getLogger(WebConfig::class.java)

    /**
     * A multi-line deployment must be able to name the origin its pages are served from.
     *
     * With one line the question does not arise: every request is same-origin. With two, the page
     * comes from one origin and races requests to another, and the second one has to recognise the
     * first. The same-origin entry (url "") cannot supply it — it means "wherever the client came
     * from", which is a fact about the client, not about this deployment.
     *
     * So it has to be configured, and there are two honest ways to say it: give every line an
     * explicit url (one source of truth, preferred), or name the public origin in
     * application.cors-origin. Refusing to start is the right response to neither, because the
     * alternative is a deployment where the health panel looks plausible and every real request
     * over the new line is refused by our own CORS — which is exactly how this was found, in
     * production, after it had been shipped.
     */
    @PostConstruct
    fun requireThePageOriginIsNameable() {
        if (lines.lines.size < 2) return
        if (lines.lines.none { it.url.isEmpty() }) return
        if (configuredOrigins().any { it.startsWith("http") }) return
        error(
            "multi-line CORS: with more than one line configured, the origin your pages are served " +
                "from must be nameable, and the same-origin line (url \"\") cannot name it. " +
                "Either give every line an explicit url in application.multipath.lines, or set " +
                "application.cors-origin to your public origin (e.g. https://microteams.app). " +
                "Without it, every credentialed request racing to another line is refused by CORS."
        )
    }

    private fun configuredOrigins(): List<String> =
        applicationConfig.corsOrigin.split(",").map { it.trim() }.filter { it.isNotEmpty() }

    @Bean
    fun corsFilter(): CorsFilter {
        val configured = configuredOrigins()
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
        // Logged once, because "what does the server think it allows?" is the first question asked
        // when a line answers probes and refuses requests, and it took a production investigation
        // to
        // answer it last time.
        logger.info(
            "CORS: allowing configured={} lines={} plus each request's own forwarded origin",
            configured,
            lineOrigins,
        )
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
