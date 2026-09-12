/*
 *  Description: The two endpoints the transport layer reads: which paths lead here, and whether
 *               this one is alive.
 *
 *               Both are public, and for the same reason: they are asked before there is a session.
 *               A client cannot log in until it can reach the server, and it cannot decide which
 *               route to reach it by until it knows the routes exist. Neither answer says anything
 *               about any user.
 *
 *               Neither belongs to a feature. Nothing here knows what a chat or a machine is, and
 *               nothing about chats or machines has to know that more than one route exists. One
 *               class implements both generated interfaces because they are one concern; the
 *               generator splits by path segment, which is not the same thing as by subject.
 *
 *  Author(s):
 *      agent3
 */

package app.microteams.transport

import app.microteams.api.LinesApi
import app.microteams.api.ProbeApi
import app.microteams.model.LineDTO
import app.microteams.model.LineRegistryDTO
import org.rucca.cheese.auth.annotation.NoAuth
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.context.request.RequestContextHolder
import org.springframework.web.context.request.ServletRequestAttributes

@RestController
class TransportController(private val lines: LineRegistryProperties) : ProbeApi, LinesApi {

    /**
     * Answer, and touch nothing.
     *
     * Every client probes every line every few seconds, so whatever this endpoint reaches would be
     * reached at that rate too. A liveness probe that queries the database measures the database,
     * and takes it down with it on the day it is slow.
     */
    @NoAuth
    override fun probe(): ResponseEntity<Unit> =
        ResponseEntity.status(HttpStatus.NO_CONTENT).build()

    /**
     * The configured lines, or the single same-origin line that means "however you got here".
     *
     * The fallback is not a placeholder: it is the correct answer for a deployment with one public
     * route, which is every deployment until someone adds a second one.
     */
    @NoAuth
    override fun listLines(): ResponseEntity<LineRegistryDTO> {
        val configured =
            lines.lines.map {
                LineDTO(
                    id = it.id,
                    url = it.url,
                    transport = it.transport,
                    weight = it.weight,
                    foreignOrigin = it.foreignOrigin,
                )
            }
        val registry = configured.ifEmpty {
            // A WebSocket upgrade, not "same-origin". Up to MultiPath 0.1.6 this field was a
            // free-form label for diagnosis and nothing read it; from 0.2.0 it NAMES THE
            // ENCAPSULATION a client opens the line with, and a value outside its vocabulary
            // (ws, wss, tcp, tls) is refused. The old label would now mean every client fails to
            // dial every line — silently, since a client that cannot dial simply has no lines
            // rather than an error to show.
            //
            // A WebSocket rather than raw tls because every deployment has a proxy in front: the
            // link arrives as an upgrade at /mt/link, which is what nginx routes to the origin
            // process. Raw tls would open a TLS connection to 443 and speak something nginx does
            // not answer.
            //
            // ws or wss is READ OFF THIS REQUEST rather than fixed, because the two differ
            // exactly where getting it wrong is invisible: a deployment behind plain HTTP handed
            // "wss" would have every client fail to dial and fall back to sending directly,
            // which works — so the transport would be switched off and nothing would say so.
            listOf(LineDTO(id = "origin", url = "", transport = socketScheme(), weight = 100))
        }
        return ResponseEntity.ok(LineRegistryDTO(lines = registry))
    }

    /**
     * "wss" when the client reached us over TLS, "ws" when it did not.
     *
     * X-Forwarded-Proto first, because the proxy is what terminated the TLS and this application
     * only ever sees plain HTTP from it; the request's own scheme is the answer when nothing is in
     * front, which is the case in a test that talks to this process directly.
     */
    private fun socketScheme(): String {
        // Asked for at call time rather than injected into the constructor. This controller is a
        // singleton, and a request injected into a singleton is captured once: every later caller
        // is
        // then answered with the FIRST caller's headers. That is not a theory — it is what this
        // did,
        // and the shape of the bug is the worst kind, because it is right for whoever happens to
        // ask
        // first and wrong for everybody after them.
        val request =
            (RequestContextHolder.getRequestAttributes() as? ServletRequestAttributes)?.request
        val forwarded = request?.getHeader("X-Forwarded-Proto")?.substringBefore(',')?.trim()
        val scheme = if (!forwarded.isNullOrEmpty()) forwarded else request?.scheme
        return if (scheme.equals("https", ignoreCase = true)) "wss" else "ws"
    }
}
