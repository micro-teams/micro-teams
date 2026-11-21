/*
 *  Description: How a live request learns what its answer was made from.
 *
 *               The live hub answers a subscription by sending the subscribed GET to this very
 *               server over loopback HTTP, as an ordinary request: every filter, the authorization
 *               matrix and the controller run exactly as for any other caller, so a live answer can
 *               never differ from the plain one. Such a request carries the header X-Live-Probe
 *               with this boot's secret; for it alone the filter records the sources the request
 *               read (common/live/Sources.kt) and returns them in the response header
 *               X-Live-Sources, comma-separated. A request without the secret, or not from
 *               loopback, is not recorded and gets no such header.
 *
 *               LiveProbe (a Spring bean):
 *                 secret — this boot's random secret; only the live hub knows it.
 *                 PROBE_HEADER, SOURCES_HEADER — the two header names.
 *               LiveProbeFilter — the servlet filter, registered for every path.
 *
 *               Example: GET /chat with "X-Live-Probe: <secret>" answers with
 *                 "X-Live-Sources: thread,thread_member,message,user_profile".
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.live

import app.microteams.common.live.ReadSources
import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import java.net.InetAddress
import java.security.SecureRandom
import java.util.HexFormat
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter
import org.springframework.web.util.ContentCachingResponseWrapper

@Component
class LiveProbe {
    val secret: String =
        HexFormat.of().formatHex(ByteArray(24).also { SecureRandom().nextBytes(it) })

    companion object {
        const val PROBE_HEADER = "X-Live-Probe"
        const val SOURCES_HEADER = "X-Live-Sources"
    }
}

@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
class LiveProbeFilter(private val probe: LiveProbe) : OncePerRequestFilter() {
    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        chain: FilterChain,
    ) {
        val asked = request.getHeader(LiveProbe.PROBE_HEADER)
        if (
            asked == null ||
                asked != probe.secret ||
                !InetAddress.getByName(request.remoteAddr).isLoopbackAddress
        ) {
            chain.doFilter(request, response)
            return
        }
        val buffered = ContentCachingResponseWrapper(response)
        val (_, read) = ReadSources.record { chain.doFilter(request, buffered) }
        buffered.setHeader(LiveProbe.SOURCES_HEADER, read.joinToString(","))
        buffered.copyBodyToResponse()
    }
}
