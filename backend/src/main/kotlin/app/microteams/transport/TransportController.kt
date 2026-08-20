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
            listOf(LineDTO(id = "origin", url = "", transport = "same-origin", weight = 100))
        }
        return ResponseEntity.ok(LineRegistryDTO(lines = registry))
    }
}
