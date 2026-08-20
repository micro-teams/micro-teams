/*
 *  Description: Who is allowed to use the operator surface, and — more importantly — the shape that
 *               makes it impossible for that credential to work anywhere else.
 *
 *               The rule is NOT "the public port rejects an operator token". A rule like that is a
 *               line of code someone relaxes later to make something convenient work, and it fails
 *               open. The rule here is that the public port contains nothing that can verify one:
 *               this token is an opaque string compared byte for byte, it is not a JWT, it never
 *               reaches AuthorizationService, and the only thing that reads it is a filter mounted
 *               on the management port. A public request carrying it gets an ordinary
 *               authentication failure — not because it was refused, but because on that side of
 *               the application nothing knows what it is.
 *
 *               The converse holds too: a user's JWT means nothing here. The management port has no
 *               notion of a user at all. One credential per surface, no crossing, so no identity can
 *               accidentally acquire authority on the other side.
 *
 *               Two more things carry as much weight as the token:
 *
 *               The port must not be public, and that matters more than the secret does: an operator
 *               reaches it through an SSH tunnel, so even a leaked token is not something the
 *               internet can use. Where the restriction goes depends on how this runs — bind the
 *               management port to 127.0.0.1 directly, or, in the bundled container deployment,
 *               publish it as `127.0.0.1:9090:9090` on the host (binding to the CONTAINER's loopback
 *               instead would make the published port reach nothing). deploy/README.md spells this
 *               out, because it is the kind of detail that is silently got wrong.
 *
 *               With no token configured the surface does not exist. A blank default would mean a
 *               deployment that forgot to set one is wide open to anything that can reach the port,
 *               and "we forgot" is the normal case, not the exotic one.
 *
 *               DO NOT merge this filter chain with the application's. They are two objects on
 *               purpose. Every incident of this kind starts with someone reusing one of them to
 *               save ten lines.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.ops

import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import java.security.MessageDigest
import org.slf4j.LoggerFactory
import org.springframework.web.filter.OncePerRequestFilter

class OpsAuthFilter(private val token: String) : OncePerRequestFilter() {

    private val logger = LoggerFactory.getLogger(OpsAuthFilter::class.java)

    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        chain: FilterChain,
    ) {
        if (!request.requestURI.startsWith("/ops")) {
            chain.doFilter(request, response)
            return
        }
        if (token.isBlank()) {
            // Not configured means not available. See the header: a blank token must never mean
            // "let everyone in".
            logger.warn("ops: refused {} — no operator token is configured", request.requestURI)
            response.sendError(HttpServletResponse.SC_NOT_FOUND)
            return
        }
        val presented = request.getHeader("X-Ops-Token")
        if (presented == null || !constantTimeEquals(presented, token)) {
            logger.warn("ops: refused {} — bad or missing operator token", request.requestURI)
            response.sendError(HttpServletResponse.SC_UNAUTHORIZED)
            return
        }
        chain.doFilter(request, response)
    }

    /** Compared over digests so the comparison tells an attacker nothing about length or prefix. */
    private fun constantTimeEquals(a: String, b: String): Boolean {
        val sha = MessageDigest.getInstance("SHA-256")
        return MessageDigest.isEqual(sha.digest(a.toByteArray()), sha.digest(b.toByteArray()))
    }
}
