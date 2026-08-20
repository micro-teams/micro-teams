/*
 *  Description: One browser connection to the updates socket, from hello to hang-up.
 *
 *               It does very little on purpose: parse a frame, ask TopicAuthorizer whether the user
 *               may have it, hand the subscription to UpdatesRegistry, and write frames back. The
 *               interesting logic (cursors, rings, gaps, who-still-may-hear-this) lives in the
 *               registry where it can be tested without a socket.
 *
 *               Every subscribe is answered with an `ack` — including the refusals. A silent refusal
 *               is indistinguishable from a topic that is merely quiet, and the frontend would wait
 *               forever for updates it is never going to get.
 *
 *               Sends go through a queue rather than straight onto the session, for the same reason
 *               the live screen learned to (see ViewerPump): a publisher must never end up blocked
 *               on someone's slow connection. Here the publisher is whatever business thread just
 *               committed a write.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.updates

import com.fasterxml.jackson.databind.ObjectMapper
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.atomic.AtomicBoolean
import org.slf4j.LoggerFactory
import org.springframework.web.socket.CloseStatus
import org.springframework.web.socket.TextMessage
import org.springframework.web.socket.WebSocketSession
import org.springframework.web.socket.handler.TextWebSocketHandler

/** How many unwritten frames a browser may owe before we stop trying to keep it up to date. */
const val UPDATES_QUEUE_DEPTH = 512

class UpdatesHandler(
    private val registry: UpdatesRegistry,
    private val catalog: TopicCatalog,
    private val objectMapper: ObjectMapper,
) : TextWebSocketHandler() {

    private val logger = LoggerFactory.getLogger(UpdatesHandler::class.java)
    private val sinks = ConcurrentHashMap<String, SessionSink>()

    /**
     * A connection's outbox. Frames are small and idempotent-ish (each one only says "refetch this
     * topic"), so when a client falls hopelessly behind the honest move is to hang up: on reconnect
     * it sends `since` and is either caught up or told `gap`, both of which are correct. Dropping
     * frames quietly would not be.
     */
    private inner class SessionSink(
        private val session: WebSocketSession,
        override val userId: Long,
    ) : UpdatesSink {
        private val queue = LinkedBlockingQueue<UpdateFrame>()
        private val stop = UpdateFrame(t = "__stop")
        private val closed = AtomicBoolean(false)

        init {
            Thread({ pump() }, "updates-${session.id}").apply { isDaemon = true }.start()
        }

        override fun send(frame: UpdateFrame) {
            if (closed.get()) return
            if (queue.size >= UPDATES_QUEUE_DEPTH) {
                logger.warn("updates: client {} is too far behind, closing it", session.id)
                close()
                try {
                    session.close(CloseStatus.SESSION_NOT_RELIABLE)
                } catch (e: Exception) {
                    logger.debug("updates: closing {} failed: {}", session.id, e.toString())
                }
                return
            }
            queue.put(frame)
        }

        fun close() {
            if (closed.compareAndSet(false, true)) queue.put(stop)
        }

        private fun pump() {
            while (true) {
                val frame =
                    try {
                        queue.take()
                    } catch (e: InterruptedException) {
                        Thread.currentThread().interrupt()
                        return
                    }
                if (frame === stop) return
                try {
                    val text = objectMapper.writeValueAsString(frame)
                    synchronized(session) {
                        if (session.isOpen) session.sendMessage(TextMessage(text))
                    }
                } catch (e: Exception) {
                    logger.debug("updates: write to {} failed: {}", session.id, e.toString())
                    return
                }
            }
        }
    }

    override fun afterConnectionEstablished(session: WebSocketSession) {
        val userId = session.attributes["userId"] as? Long
        if (userId == null) {
            session.close(CloseStatus.POLICY_VIOLATION.withReason("unauthenticated"))
            return
        }
        sinks[session.id] = SessionSink(session, userId)
    }

    override fun handleTextMessage(session: WebSocketSession, message: TextMessage) {
        val sink = sinks[session.id] ?: return
        val frame =
            try {
                objectMapper.readValue(message.payload, ClientFrame::class.java)
            } catch (e: Exception) {
                return // unparseable: ignore, exactly like an unknown frame type
            }
        when (frame.t) {
            "sub" -> subscribe(sink, frame)
            "unsub" -> frame.topics.orEmpty().forEach { registry.unsubscribe(it, sink) }
            "ping" -> sink.send(UpdateFrame.pong())
            else -> {} // an unrecognised frame type is ignored in silence, by design
        }
    }

    private fun subscribe(sink: SessionSink, frame: ClientFrame) {
        val granted = mutableListOf<String>()
        val refused = mutableListOf<String>()
        val cursors = mutableMapOf<String, Long>()
        for (raw in frame.topics.orEmpty()) {
            val topic = catalog.parse(raw)
            if (topic == null || !catalog.mayRead(sink.userId, topic)) {
                refused.add(raw)
                continue
            }
            // A null cursor means we do not know where this topic stands; leaving it out of the
            // ack is how the client is told that, and subscribe() has already sent it a gap.
            registry.subscribe(raw, sink, frame.since?.get(raw))?.let { cursors[raw] = it }
            granted.add(raw)
        }
        sink.send(UpdateFrame.ack(granted, refused, cursors))
    }

    override fun afterConnectionClosed(session: WebSocketSession, status: CloseStatus) {
        val sink = sinks.remove(session.id) ?: return
        registry.forget(sink)
        sink.close()
    }
}
