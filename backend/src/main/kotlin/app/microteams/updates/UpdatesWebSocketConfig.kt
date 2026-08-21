/*
 *  Description: The updates endpoint, `/updates`, and its handshake.
 *
 *               `/updates`, NOT `/mt/updates`: the `/mt` prefix belongs to the gateway, which
 *               strips it (`proxy_pass http://backend:8080/` in deploy/nginx.conf) before this
 *               server ever sees a path. A browser therefore dials `/mt/updates` and arrives here
 *               as `/updates` — the same arrangement the machine sockets already use.
 *               Registering the prefixed path instead means the endpoint answers only when it is
 *               reached directly, which is true in a test and false everywhere else.
 *
 *               Built the way ConnectorWebSocketConfig is built, and for the same reason: the chat
 *               module owns `@EnableWebSocketMessageBroker`, which defines the application-wide
 *               `webSocketHandlerMapping` bean, so a second `@EnableWebSocket` here would clash.
 *               Raw handler mapping by hand, unique bean name, negative order.
 *
 *               That this is now the THIRD hand-built WebSocket assembly in the codebase is not
 *               lost on anyone; extracting the shared skeleton (handshake auth, session registry,
 *               heartbeat, close semantics) is the one backend refactor worth doing, and it wants to
 *               happen once all three are known to work rather than while one of them is being
 *               written. See todo/microteams/plan-staged-refactor.md.
 *
 *               Authentication is the `?token=` JWT, exactly as the live-screen viewer does it.
 *               Authorization is NOT done here: a connection grants nothing on its own, every topic
 *               is asked for separately and answered with an ack.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.updates

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
class UpdatesWebSocketConfig {

    /** One registry for the whole application: it is the shared state the sockets talk about. */
    @Bean fun updatesRegistry(): UpdatesRegistry = UpdatesRegistry()

    /**
     * Every declared query, collected by type. A new topic is a new @Component implementing
     * SyncedQuery and nothing else — there is no list to remember to add it to.
     */
    @Bean fun topicCatalog(queries: List<SyncedQuery<*>>): TopicCatalog = TopicCatalog(queries)

    @Bean
    fun updatesHandler(
        registry: UpdatesRegistry,
        catalog: TopicCatalog,
        objectMapper: ObjectMapper,
    ): UpdatesHandler = UpdatesHandler(registry, catalog, objectMapper)

    @Bean
    fun updatesWsRequestHandler(
        updatesHandler: UpdatesHandler,
        authorizationService: AuthorizationService,
    ): WebSocketHttpRequestHandler {
        val requestHandler = WebSocketHttpRequestHandler(updatesHandler)
        requestHandler.handshakeInterceptors.add(UpdatesHandshakeInterceptor(authorizationService))
        return requestHandler
    }

    @Bean
    fun updatesWsHandlerMapping(
        updatesWsRequestHandler: WebSocketHttpRequestHandler
    ): HandlerMapping {
        val mapping = SimpleUrlHandlerMapping()
        mapping.order = -1
        mapping.urlMap = mapOf("/updates" to updatesWsRequestHandler)
        return mapping
    }
}

/** Identifies the browser. Says nothing about what it may subscribe to — that is per topic. */
class UpdatesHandshakeInterceptor(private val authorizationService: AuthorizationService) :
    HandshakeInterceptor {
    private val logger = LoggerFactory.getLogger(UpdatesHandshakeInterceptor::class.java)

    override fun beforeHandshake(
        request: ServerHttpRequest,
        response: ServerHttpResponse,
        wsHandler: WebSocketHandler,
        attributes: MutableMap<String, Any>,
    ): Boolean {
        val token =
            request.uri.query
                ?.split("&")
                ?.firstOrNull { it.startsWith("token=") }
                ?.removePrefix("token=")
        return try {
            val auth = authorizationService.verify(token)
            attributes["userId"] = auth.userId
            true
        } catch (e: Exception) {
            logger.warn("updates handshake rejected: bad token")
            false
        }
    }

    override fun afterHandshake(
        request: ServerHttpRequest,
        response: ServerHttpResponse,
        wsHandler: WebSocketHandler,
        exception: Exception?,
    ) {}
}
