/*
 *  Description: The 现场 (live screen) viewer WebSocket — the browser end of watching an
 *               agent's Claude Code terminal. It speaks the SAME wire the reference
 *               misc/web-claude client speaks, so that client is reused verbatim: the
 *               machine's raw screen bytes go to the browser as binary frames; the browser
 *               sends raw input bytes (binary) and JSON control — {type:"control",level},
 *               {type:"resize",cols,rows}, {type:"compact"} — nothing is base64-wrapped.
 *               A viewer is authenticated by its ?token= JWT and authorized to a screen only
 *               if it shares the screen's team or a chat group with the agent.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.machine.screen

import app.microteams.machine.link.MachineHub
import app.microteams.machine.link.ViewerTransport
import com.fasterxml.jackson.databind.ObjectMapper
import java.util.concurrent.ConcurrentHashMap
import org.slf4j.LoggerFactory
import org.springframework.web.socket.BinaryMessage
import org.springframework.web.socket.CloseStatus
import org.springframework.web.socket.TextMessage
import org.springframework.web.socket.WebSocketSession
import org.springframework.web.socket.handler.AbstractWebSocketHandler

class ViewerHandler(private val hub: MachineHub, private val objectMapper: ObjectMapper) :
    AbstractWebSocketHandler() {
    private val logger = LoggerFactory.getLogger(ViewerHandler::class.java)

    private class ViewerState(
        val machineId: String,
        val sid: String,
        val transport: ViewerTransport,
    )

    private val states = ConcurrentHashMap<String, ViewerState>()

    override fun afterConnectionEstablished(session: WebSocketSession) {
        val sid = session.attributes["sid"] as? String
        val screen = sid?.let { hub.screen(it) }
        if (screen == null) {
            session.close(CloseStatus.POLICY_VIOLATION.withReason("screen not found"))
            return
        }
        session.binaryMessageSizeLimit = 1 shl 20
        session.textMessageSizeLimit = 1 shl 20
        // Raw machine bytes -> a binary frame to the browser (web-claude writes it straight
        // into xterm). Serialize sends: the hub's fan-out thread and any control replies
        // share the one session.
        val transport = ViewerTransport { raw ->
            synchronized(session) {
                if (session.isOpen)
                    session.sendMessage(BinaryMessage(java.nio.ByteBuffer.wrap(raw)))
            }
        }
        val state = ViewerState(screen.machineId, screen.sid, transport)
        states[session.id] = state
        hub.attachViewer(screen.machineId, screen.sid, transport)
    }

    override fun handleBinaryMessage(session: WebSocketSession, message: BinaryMessage) {
        val state = states[session.id] ?: return
        val buf = message.payload
        val data = ByteArray(buf.remaining()).also { buf.get(it) }
        // Raw keystrokes typed into the terminal (web-claude sends these only in 'full' mode).
        hub.viewerInput(state.machineId, state.sid, data)
    }

    override fun handleTextMessage(session: WebSocketSession, message: TextMessage) {
        val state = states[session.id] ?: return
        val msg =
            try {
                objectMapper.readTree(message.payload)
            } catch (e: Exception) {
                return
            }
        when (msg.path("type").asText()) {
            "control" ->
                hub.viewerControl(state.machineId, state.sid, msg.path("level").asText("passive"))
            "resize" -> {
                val cols = msg.path("cols").asInt(0)
                val rows = msg.path("rows").asInt(0)
                if (cols > 0 && rows > 0) hub.viewerResize(state.machineId, state.sid, cols, rows)
            }
            "compact" -> hub.callScreen(state.machineId, state.sid, "compact", emptyList())
        }
    }

    override fun afterConnectionClosed(session: WebSocketSession, status: CloseStatus) {
        val state = states.remove(session.id) ?: return
        hub.detachViewer(state.machineId, state.sid, state.transport)
    }
}
