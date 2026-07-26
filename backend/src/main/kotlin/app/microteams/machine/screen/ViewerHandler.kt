/*
 *  Description: The live-screen viewer WebSocket — the browser end of watching an
 *               agent's Claude Code terminal. It speaks the SAME wire the reference
 *               misc/web-claude client speaks, so that client is reused verbatim: the
 *               machine's raw screen bytes go to the browser as binary frames; the browser
 *               sends raw input bytes (binary) and JSON control — {type:"control",level},
 *               {type:"resize",cols,rows}, {type:"compact"}, {type:"scroll",dir} — nothing is
 *               base64-wrapped. `scroll` pages the pane's tmux history (copy-mode), since the
 *               full-screen program keeps no scrollback of its own.
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

/**
 * Asked, just before a viewer attaches, whether anything needs doing to the screen first — the
 * machine layer has no idea what runs on one, so what "needs doing" means belongs to the module
 * that opened it (for agents: waking a program that has died, so the live screen opens onto a live
 * terminal rather than the frozen last frame of a crash). It returns the sid to actually attach to,
 * which is normally the one passed in.
 */
fun interface ScreenAttachPreflight {
    fun beforeAttach(sid: String): String
}

class ViewerHandler(
    private val hub: MachineHub,
    private val objectMapper: ObjectMapper,
    private val preflight: ScreenAttachPreflight? = null,
) : AbstractWebSocketHandler() {
    private val logger = LoggerFactory.getLogger(ViewerHandler::class.java)

    private class ViewerState(
        val machineId: String,
        val sid: String,
        val transport: ViewerTransport,
    )

    private val states = ConcurrentHashMap<String, ViewerState>()

    override fun afterConnectionEstablished(session: WebSocketSession) {
        // The handshake authorized this human against the sid they asked for; the preflight may
        // hand back a different one, but only ever another screen of the SAME agent (it resolves
        // the agent from this sid and reports where that agent lives now), so the authorization
        // that was granted still covers what we attach to.
        val asked = session.attributes["sid"] as? String
        val sid = asked?.let { preflight?.beforeAttach(it) ?: it }
        val screen = sid?.let { hub.screen(it) }
        if (screen == null) {
            // The viewer sees an empty terminal either way; only this line says why. Whoever owns
            // the screen was already asked to ensure it exists (the preflight), so reaching here
            // means that could not be done.
            logger.error("live screen: no screen '{}' to attach to (asked for '{}')", sid, asked)
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
            // Page through the pane's tmux scrollback (copy-mode) — see hub.viewerScroll.
            "scroll" ->
                hub.viewerScroll(state.machineId, state.sid, msg.path("dir").asText("bottom"))
        }
    }

    override fun afterConnectionClosed(session: WebSocketSession, status: CloseStatus) {
        val state = states.remove(session.id) ?: return
        hub.detachViewer(state.machineId, state.sid, state.transport)
    }
}
