/*
 *  Description: A minimal, runtime OpenAPI document served at /openapi.json for the agent
 *               CLI's `microteams api` (Restish loads it live and turns each operation into
 *               `microteams api <operation>`). The backend is OpenAPI-first at BUILD time but does
 *               not serve a live spec, so this hand-written slice publishes exactly the
 *               operations an agent needs from inside a screen — currently `post-note`
 *               (operationId `postNote`) — pointed at the request's own origin so the CLI's
 *               generated calls hit this server. Public (@NoAuth): the CLI fetches it before
 *               it has resolved a token, and the tool-door does its own attribution.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.agent

import jakarta.servlet.http.HttpServletRequest
import org.rucca.cheese.auth.annotation.NoAuth
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController

/**
 * The tool-door path this document advertises. It must stay equal to the `/agent/note` mapping
 * AgentApi generates from MicroTeams-API.yml: this document is what `microteams api` builds its
 * commands from, so a drift here is not a compile error but a live agent whose every reply 404s.
 * AgentLoopTest pins the two together.
 */
const val POST_NOTE_PATH = "/agent/note"

@RestController
class AgentOpenApiController {

    @NoAuth
    @GetMapping("/openapi.json")
    fun openapi(request: HttpServletRequest): Map<String, Any> {
        val origin = origin(request)
        return mapOf(
            "openapi" to "3.0.3",
            "info" to mapOf("title" to "micro-agent-teams agent API", "version" to "1.0.0"),
            "servers" to listOf(mapOf("url" to origin)),
            "paths" to
                mapOf(
                    POST_NOTE_PATH to
                        mapOf(
                            "post" to
                                mapOf(
                                    "operationId" to "postNote",
                                    "summary" to "Post a message into your current group chat",
                                    "requestBody" to
                                        mapOf(
                                            "required" to true,
                                            "content" to
                                                mapOf(
                                                    "application/json" to
                                                        mapOf(
                                                            "schema" to
                                                                mapOf(
                                                                    "type" to "object",
                                                                    "required" to listOf("text"),
                                                                    "properties" to
                                                                        mapOf(
                                                                            "text" to
                                                                                mapOf(
                                                                                    "type" to
                                                                                        "string",
                                                                                    "description" to
                                                                                        "the message to send to the group",
                                                                                ),
                                                                            "thread_id" to
                                                                                mapOf(
                                                                                    "type" to
                                                                                        "integer",
                                                                                    "format" to
                                                                                        "int64",
                                                                                    "description" to
                                                                                        "target group id (defaults to your most recent group)",
                                                                                ),
                                                                        ),
                                                                )
                                                        )
                                                ),
                                        ),
                                    "responses" to
                                        mapOf(
                                            "200" to
                                                mapOf(
                                                    "description" to "the posted message",
                                                    "content" to
                                                        mapOf(
                                                            "application/json" to
                                                                mapOf(
                                                                    "schema" to
                                                                        mapOf("type" to "object")
                                                                )
                                                        ),
                                                )
                                        ),
                                )
                        )
                ),
        )
    }

    private fun origin(request: HttpServletRequest): String {
        val proto = request.getHeader("X-Forwarded-Proto") ?: request.scheme
        val host = request.getHeader("X-Forwarded-Host") ?: request.getHeader("Host")
        return "$proto://$host"
    }
}
