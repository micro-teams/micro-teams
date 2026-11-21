/*
 *  Description: Live requests: any GET of this API, held open, answered now and again every time
 *               its answer would differ.
 *
 *               A client opens one WebSocket, /live (/mt/live through the gateway), and multiplexes
 *               its requests over it:
 *                 client -> server  {"t":"auth","token":"<jwt>"}       the token later requests use
 *                                   {"t":"get","id":"a1","path":"/chat?page_size=50"}
 *                                   {"t":"stop","id":"a1"}
 *                                   {"t":"ping"}                         answered {"t":"pong"}
 *                 server -> client  {"t":"result","id":"a1","status":200,"body":{...}}
 *               The first result arrives at once; another arrives only when the answer changed, and
 *               it is always the whole answer, never a patch, so a client has one way to take an
 *               answer in whether it is the first, a later one, or one after a reconnect.
 *
 *               How an answer is made: the hub sends the GET to this server over loopback with the
 *               socket's token (see LiveProbe), so authorization and the controller run exactly as
 *               for a plain request, and gets back the answer and the sources it read. When a source
 *               changes (ChangeBus), every subscription that read it runs again, at most once per
 *               RERUN_GAP_MS each, and a result identical to the last one sent is not sent. A change
 *               while a subscription is running makes it run again afterwards, whatever it read, so
 *               a change is never lost between a read and the end of a run.
 *
 *               An unknown frame is ignored. A token that stops being valid makes every answer 401;
 *               the client sends a fresh one with "auth", and every subscription runs again.
 *
 *               LiveHub (a Spring bean, also the WebSocket handler):
 *                 RERUN_GAP_MS — the shortest time between two runs of one subscription.
 *                 MAX_SUBSCRIPTIONS — the most one socket may hold open.
 *                 RETRY_MS — how long after a failed run (the loopback request itself failed) it
 *                   runs again.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.live

import app.microteams.common.live.ANY_SOURCE
import app.microteams.common.live.ChangeBus
import jakarta.annotation.PreDestroy
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.slf4j.LoggerFactory
import org.springframework.core.env.Environment
import org.springframework.stereotype.Component
import org.springframework.web.socket.CloseStatus
import org.springframework.web.socket.TextMessage
import org.springframework.web.socket.WebSocketSession
import org.springframework.web.socket.handler.TextWebSocketHandler
import tools.jackson.databind.JsonNode
import tools.jackson.databind.ObjectMapper

@Component
class LiveHub(
    private val probe: LiveProbe,
    private val bus: ChangeBus,
    private val environment: Environment,
    private val objectMapper: ObjectMapper,
) : TextWebSocketHandler() {
    private val logger = LoggerFactory.getLogger(LiveHub::class.java)
    private val http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build()
    private val runner =
        Executors.newScheduledThreadPool(4) { r -> Thread(r, "live").apply { isDaemon = true } }
    private val sockets = ConcurrentHashMap<String, Socket>()
    private val subscription = bus.subscribe { source -> changed(source) }

    private inner class Socket(val session: WebSocketSession, @Volatile var token: String?) {
        val subs = ConcurrentHashMap<String, Sub>()

        fun send(node: Any) {
            val text = objectMapper.writeValueAsString(node)
            synchronized(session) { if (session.isOpen) session.sendMessage(TextMessage(text)) }
        }
    }

    private inner class Sub(val socket: Socket, val id: String, val path: String) {
        var read: Set<String>? = null
        var running = false
        var dirty = false
        var scheduled = false
        var stopped = false
        var lastRun = 0L
        var lastSent: String? = null
    }

    @PreDestroy
    fun close() {
        subscription.close()
        runner.shutdownNow()
    }

    override fun afterConnectionEstablished(session: WebSocketSession) {
        sockets[session.id] = Socket(session, session.attributes["token"] as String?)
    }

    override fun afterConnectionClosed(session: WebSocketSession, status: CloseStatus) {
        val socket = sockets.remove(session.id) ?: return
        socket.subs.values.forEach { synchronized(it) { it.stopped = true } }
    }

    override fun handleTextMessage(session: WebSocketSession, message: TextMessage) {
        val socket = sockets[session.id] ?: return
        val frame: JsonNode =
            try {
                objectMapper.readTree(message.payload)
            } catch (e: Exception) {
                return
            }
        when (frame.path("t").asString("")) {
            "auth" -> {
                socket.token = frame.path("token").asString(null)
                socket.subs.values.forEach { schedule(it) }
            }
            "get" -> {
                val id = frame.path("id").asString("")
                val path = frame.path("path").asString("")
                if (id.isEmpty() || !path.startsWith("/")) return
                if (socket.subs.size >= MAX_SUBSCRIPTIONS && !socket.subs.containsKey(id)) {
                    socket.send(mapOf("t" to "result", "id" to id, "status" to 429, "body" to null))
                    return
                }
                val sub = Sub(socket, id, path.removePrefix("/mt").ifEmpty { "/" })
                socket.subs.put(id, sub)?.let { old -> synchronized(old) { old.stopped = true } }
                schedule(sub)
            }
            "ping" -> socket.send(mapOf("t" to "pong"))
            "stop" ->
                socket.subs.remove(frame.path("id").asString(""))?.let {
                    synchronized(it) { it.stopped = true }
                }
        }
    }

    private fun changed(source: String) {
        for (socket in sockets.values) {
            for (sub in socket.subs.values) {
                val hit =
                    synchronized(sub) {
                        if (sub.running) {
                            sub.dirty = true
                            false
                        } else source == ANY_SOURCE || sub.read?.contains(source) != false
                    }
                if (hit) schedule(sub)
            }
        }
    }

    private fun schedule(sub: Sub) {
        val delay =
            synchronized(sub) {
                if (sub.stopped || sub.scheduled) return
                if (sub.running) {
                    sub.dirty = true
                    return
                }
                sub.scheduled = true
                maxOf(0L, sub.lastRun + RERUN_GAP_MS - System.currentTimeMillis())
            }
        runner.schedule({ run(sub) }, delay, TimeUnit.MILLISECONDS)
    }

    private fun run(sub: Sub) {
        synchronized(sub) {
            sub.scheduled = false
            if (sub.stopped) return
            sub.running = true
            sub.dirty = false
            sub.lastRun = System.currentTimeMillis()
        }
        var read: Set<String>? = null
        var text: String? = null
        try {
            val (status, body, sources) = fetch(sub.path, sub.socket.token)
            read = sources
            val parsed = if (body.isBlank()) null else objectMapper.readTree(body)
            text =
                objectMapper.writeValueAsString(
                    mapOf("t" to "result", "id" to sub.id, "status" to status, "body" to parsed),
                )
        } catch (e: Exception) {
            logger.warn("live: {} failed: {}", sub.path, e.toString())
        }
        val again =
            synchronized(sub) {
                sub.running = false
                if (read != null) sub.read = read
                if (text != null && text != sub.lastSent && !sub.stopped) {
                    sub.lastSent = text
                    try {
                        synchronized(sub.socket.session) {
                            if (sub.socket.session.isOpen)
                                sub.socket.session.sendMessage(TextMessage(text))
                        }
                    } catch (e: Exception) {
                        logger.debug("live: write failed: {}", e.toString())
                    }
                }
                // A failed run is tried again, but not at once: what failed is usually still
                // failing.
                if (text == null) sub.lastRun = System.currentTimeMillis() + RETRY_MS - RERUN_GAP_MS
                sub.dirty || text == null
            }
        if (again) schedule(sub)
    }

    private data class Answer(val status: Int, val body: String, val sources: Set<String>)

    private fun fetch(path: String, token: String?): Answer {
        val port =
            environment.getProperty("local.server.port")
                ?: error("the server port is not known yet")
        val builder =
            HttpRequest.newBuilder(URI.create("http://127.0.0.1:$port$path"))
                .timeout(Duration.ofSeconds(30))
                .header(LiveProbe.PROBE_HEADER, probe.secret)
                .header("Accept", "application/json")
                .GET()
        if (token != null) builder.header("Authorization", "Bearer $token")
        val res = http.send(builder.build(), HttpResponse.BodyHandlers.ofString())
        val sources =
            res.headers()
                .firstValue(LiveProbe.SOURCES_HEADER)
                .orElse("")
                .split(',')
                .filter { it.isNotEmpty() }
                .toSet()
        return Answer(res.statusCode(), res.body(), sources)
    }

    companion object {
        const val RERUN_GAP_MS = 100L
        const val MAX_SUBSCRIPTIONS = 200
        const val RETRY_MS = 2000L
    }
}
