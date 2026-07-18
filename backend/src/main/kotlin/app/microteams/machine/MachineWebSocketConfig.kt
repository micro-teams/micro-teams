/*
 *  Description: Wires the connector's two raw WebSocket endpoints: the machine control
 *               channel at `/agent` — the path the frozen CLI dials — and the browser's
 *               现场 viewer at `/connector/session/{sid}/screen`. Both are raw (not STOMP)
 *               and share one handler mapping, so they stay in one config.
 *
 *               The chat module already owns `@EnableWebSocketMessageBroker`
 *               (STOMP for the browser), and adding `@EnableWebSocket` here would define a
 *               second `webSocketHandlerMapping` bean and clash. So we register a raw
 *               handler mapping by hand (a uniquely named HandlerMapping bean) — the two
 *               WebSocket stacks coexist because their paths and bean names never overlap.
 *
 *               Authentication is by the machine token in the `X-Microteams-Session` handshake
 *               header (resolved via MachineService.verifyToken); a tokenless or unknown-token
 *               dial fails the handshake.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.machine

import app.microteams.machine.enrollment.MachineService
import app.microteams.machine.link.LinkHandler
import app.microteams.machine.link.MachineHub
import app.microteams.machine.screen.ViewerHandler
import com.fasterxml.jackson.databind.ObjectMapper
import org.rucca.cheese.auth.AuthorizationService
import org.slf4j.LoggerFactory
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.http.server.ServerHttpRequest
import org.springframework.http.server.ServerHttpResponse
import org.springframework.web.servlet.HandlerMapping
import org.springframework.web.servlet.handler.SimpleUrlHandlerMapping
import org.springframework.web.socket.WebSocketHandler
import org.springframework.web.socket.server.HandshakeInterceptor
import org.springframework.web.socket.server.support.WebSocketHttpRequestHandler

@Configuration
class ConnectorWebSocketConfig {

    @Bean
    fun connectorLinkHandler(hub: MachineHub, objectMapper: ObjectMapper): LinkHandler =
        LinkHandler(hub, objectMapper)

    /**
     * The raw `/agent` request handler as a Spring bean, so its Lifecycle (start/stop) and
     * ServletContext wiring are managed. It carries the machine-token handshake interceptor.
     */
    @Bean
    fun connectorWsRequestHandler(
        handler: LinkHandler,
        machineService: MachineService,
    ): WebSocketHttpRequestHandler {
        val requestHandler = WebSocketHttpRequestHandler(handler)
        requestHandler.handshakeInterceptors.add(MachineHandshakeInterceptor(machineService))
        return requestHandler
    }

    @Bean
    fun connectorViewerHandler(hub: MachineHub, objectMapper: ObjectMapper): ViewerHandler =
        ViewerHandler(hub, objectMapper)

    /** The 现场 viewer request handler, carrying the JWT + membership handshake authz. */
    @Bean
    fun connectorViewerRequestHandler(
        handler: ViewerHandler,
        authorizationService: AuthorizationService,
    ): WebSocketHttpRequestHandler {
        val requestHandler = WebSocketHttpRequestHandler(handler)
        requestHandler.handshakeInterceptors.add(ViewerHandshakeInterceptor(authorizationService))
        return requestHandler
    }

    /**
     * Map `/agent` (machine control) and the browser 现场 viewer at `/connector/session/{sid}/screen`
     * to their handlers. Negative order so it is consulted before the STOMP mapping.
     */
    @Bean
    fun connectorWsHandlerMapping(
        connectorWsRequestHandler: WebSocketHttpRequestHandler,
        connectorViewerRequestHandler: WebSocketHttpRequestHandler,
    ): HandlerMapping {
        val mapping = SimpleUrlHandlerMapping()
        mapping.order = -1
        mapping.urlMap =
            mapOf(
                "/machine/link" to connectorWsRequestHandler,
                "/machine/screen/*" to connectorViewerRequestHandler,
            )
        return mapping
    }
}

/**
 * Authenticates + authorizes a 现场 viewer handshake. The `?token=` JWT identifies the human; whether
 * they may watch is not decided here but asked of the permission matrix, as `watch` on a
 * `machine_screen` — so the rule lives where every other rule lives, and the modules that own the
 * screen kinds register the predicates that answer it (see RolePermissionService). The sid travels
 * in authInfo rather than as the resourceId because screen ids are strings, not IdType.
 */
class ViewerHandshakeInterceptor(private val authorizationService: AuthorizationService) :
    HandshakeInterceptor {
    private val logger = LoggerFactory.getLogger(ViewerHandshakeInterceptor::class.java)

    override fun beforeHandshake(
        request: ServerHttpRequest,
        response: ServerHttpResponse,
        wsHandler: WebSocketHandler,
        attributes: MutableMap<String, Any>,
    ): Boolean {
        // /machine/screen/{sid}
        val segments = request.uri.path.trim('/').split("/")
        val idx = segments.indexOf("screen")
        val sid = if (idx >= 0 && idx + 1 < segments.size) segments[idx + 1] else null
        if (sid.isNullOrBlank()) return false

        val token =
            request.uri.query
                ?.split("&")
                ?.firstOrNull { it.startsWith("token=") }
                ?.removePrefix("token=")
        val auth =
            try {
                authorizationService.verify(token)
            } catch (e: Exception) {
                logger.warn("viewer handshake rejected: bad token")
                return false
            }
        if (
            !authorizationService.allows(auth, "watch", "machine_screen", null, mapOf("sid" to sid))
        ) {
            logger.warn(
                "viewer handshake rejected: user {} may not watch screen {}",
                auth.userId,
                sid,
            )
            return false
        }
        attributes["sid"] = sid
        attributes["userId"] = auth.userId
        return true
    }

    override fun afterHandshake(
        request: ServerHttpRequest,
        response: ServerHttpResponse,
        wsHandler: WebSocketHandler,
        exception: Exception?,
    ) {}
}

/**
 * Authenticates a machine control-channel handshake from its `X-Microteams-Session` header. The
 * resolved machine id is stashed in the WebSocket session attributes for the handler. Any failure
 * fails the handshake (the CLI reconnects with backoff).
 */
class MachineHandshakeInterceptor(private val machineService: MachineService) :
    HandshakeInterceptor {
    private val logger = LoggerFactory.getLogger(MachineHandshakeInterceptor::class.java)

    override fun beforeHandshake(
        request: ServerHttpRequest,
        response: ServerHttpResponse,
        wsHandler: WebSocketHandler,
        attributes: MutableMap<String, Any>,
    ): Boolean {
        val token = request.headers.getFirst("X-Microteams-Session")
        if (token.isNullOrBlank()) {
            logger.warn("machine handshake rejected: missing X-Microteams-Session")
            return false
        }
        val machine = machineService.verifyToken(token)
        if (machine == null) {
            logger.warn("machine handshake rejected: unknown machine token")
            return false
        }
        attributes["machineId"] = machine.machineId
        // The CLI reports the base URL it dialed us on (the endpoint it selected); we echo it back
        // as MICROTEAMS_API for this machine's screens, so the server need not know its own
        // address.
        request.headers
            .getFirst("X-Microteams-Origin")
            ?.takeIf { it.isNotBlank() }
            ?.let { attributes["origin"] = it.trimEnd('/') }
        return true
    }

    override fun afterHandshake(
        request: ServerHttpRequest,
        response: ServerHttpResponse,
        wsHandler: WebSocketHandler,
        exception: Exception?,
    ) {}
}
