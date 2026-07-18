/*
 *  Description: The machine control-channel WebSocket handler — the transport adapter
 *               between a raw Spring WebSocketSession and the transport-free MachineHub.
 *               The frozen CLI dials `ws(s)://<base>/agent` with an `X-Microteams-Session:
 *               <machine token>` header (resolved to a machine by the handshake
 *               interceptor); this handler wires that socket to the hub: welcome on
 *               connect, dispatch every inbound link.Msg, detach on close.
 *
 *               All server→machine writes flow through HubMachine.send, which holds a
 *               per-machine lock, so the single WebSocketSession is never written
 *               concurrently (Spring sessions are not safe for concurrent sends).
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.machine.link

import com.fasterxml.jackson.databind.ObjectMapper
import java.util.concurrent.ConcurrentHashMap
import org.slf4j.LoggerFactory
import org.springframework.web.socket.CloseStatus
import org.springframework.web.socket.TextMessage
import org.springframework.web.socket.WebSocketSession
import org.springframework.web.socket.handler.TextWebSocketHandler

class LinkHandler(private val hub: MachineHub, private val objectMapper: ObjectMapper) :
    TextWebSocketHandler() {
    private val logger = LoggerFactory.getLogger(LinkHandler::class.java)

    private companion object {
        // 4 MB: comfortably above the applet source and any single terminal chunk.
        const val MAX_MESSAGE_BYTES = 4 * 1024 * 1024
    }

    private data class Bound(val machineId: String, val transport: MachineTransport)

    // session.id -> the machine + transport we attached for it, so close detaches the
    // exact same transport instance (attach/detach identity matters in the hub).
    private val bound = ConcurrentHashMap<String, Bound>()

    override fun afterConnectionEstablished(session: WebSocketSession) {
        val machineId = session.attributes["machineId"] as? String
        if (machineId == null) {
            // Should never happen — the handshake interceptor rejects tokenless dials.
            session.close(CloseStatus.POLICY_VIOLATION)
            return
        }
        // Screen frames carry the full applet source (session.create) and base64
        // terminal chunks (screen.data), which exceed the 8 KB JSR-356 default. Raise the
        // inbound reassembly limit so large machine→server frames are not dropped. (Outbound
        // large frames are auto-fragmented by the container; the frozen gorilla CLI
        // reassembles them without a client-side cap.)
        session.textMessageSizeLimit = MAX_MESSAGE_BYTES
        session.binaryMessageSizeLimit = MAX_MESSAGE_BYTES
        val transport = MachineTransport { msg ->
            session.sendMessage(TextMessage(objectMapper.writeValueAsString(msg)))
        }
        bound[session.id] = Bound(machineId, transport)
        val origin = session.attributes["origin"] as? String
        hub.attachMachine(machineId, transport, origin)
        logger.info("machine {} connected (session {})", machineId, session.id)
    }

    override fun handleTextMessage(session: WebSocketSession, message: TextMessage) {
        val b = bound[session.id] ?: return
        val msg =
            try {
                objectMapper.readValue(message.payload, LinkMsg::class.java)
            } catch (e: Exception) {
                logger.debug("dropping unparseable frame from machine {}", b.machineId)
                return
            }
        hub.onMachineMessage(b.machineId, msg)
    }

    override fun afterConnectionClosed(session: WebSocketSession, status: CloseStatus) {
        val b = bound.remove(session.id) ?: return
        hub.detachMachine(b.machineId, b.transport)
        logger.info("machine {} disconnected (session {}, {})", b.machineId, session.id, status)
    }
}
