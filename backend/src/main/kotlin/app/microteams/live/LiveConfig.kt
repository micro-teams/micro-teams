/*
 *  Description: The live endpoint, /live, and its handshake.
 *
 *               `/live`, not `/mt/live`: the gateway strips the `/mt` prefix before this server sees
 *               a path, as for the machine sockets. Built by hand (a SimpleUrlHandlerMapping of its
 *               own, negative order), the way every raw WebSocket here is.
 *
 *               The handshake only identifies the socket's first token (`?token=`); it grants
 *               nothing: every request on the socket is authorized as a plain GET would be (see
 *               LiveHub), and a socket with no valid token simply gets 401 answers.
 *
 *               LiveConfig — the beans; nothing to call.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.live

import java.net.URLDecoder
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
class LiveConfig {
    @Bean
    fun liveWsHandlerMapping(hub: LiveHub): HandlerMapping {
        val handler = WebSocketHttpRequestHandler(hub)
        handler.handshakeInterceptors.add(TokenFromQuery())
        val mapping = SimpleUrlHandlerMapping()
        mapping.order = -1
        mapping.urlMap = mapOf("/live" to handler)
        return mapping
    }
}

private class TokenFromQuery : HandshakeInterceptor {
    override fun beforeHandshake(
        request: ServerHttpRequest,
        response: ServerHttpResponse,
        wsHandler: WebSocketHandler,
        attributes: MutableMap<String, Any>,
    ): Boolean {
        request.uri.query
            ?.split("&")
            ?.firstOrNull { it.startsWith("token=") }
            ?.removePrefix("token=")
            ?.takeIf { it.isNotEmpty() }
            ?.let { attributes["token"] = URLDecoder.decode(it, Charsets.UTF_8) }
        return true
    }

    override fun afterHandshake(
        request: ServerHttpRequest,
        response: ServerHttpResponse,
        wsHandler: WebSocketHandler,
        exception: Exception?,
    ) {}
}
