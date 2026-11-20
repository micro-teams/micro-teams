/*
 *  Description: The live-screen viewer WebSocket — the browser end of watching a screen. It is
 *               reached at `/machine/screen/{sid}?token=JWT&cols=C&rows=R`, authenticated by the
 *               JWT and authorized (ViewerHandshakeInterceptor) before this handler sees it. Each
 *               connection is one viewer with its own viewer id ("v" + 8 hex), and is subscribed
 *               at once at the size it asked for — nothing waits on a round trip to the machine.
 *
 *               Client -> server:
 *                 binary                                  input bytes (keys, pastes, mouse)
 *                 {"type":"resize","cols":C,"rows":R}     the room the viewer has
 *                 {"type":"ack","n":N}                    N more bytes of screen data rendered
 *                 {"type":"lease","op":"take"|"renew"|"release"}
 *                 {"type":"capture","id":"..."}           ask for the screen's text
 *                 {"type":"command","id":"...","name":"usage"|"compact"}  call that applet function
 *                 anything else is ignored, except that on a protocol 1 machine the older client's
 *                 {"type":"control","level"} and {"type":"scroll","dir"} are still honoured, and
 *                 {"type":"compact"} is honoured on both.
 *
 *               Server -> client, all through the viewer's one ViewerPump so nothing overtakes:
 *                 binary                                  screen bytes for this viewer
 *                 {"type":"size","cols":C,"rows":R}       the terminal's size from now on
 *                 {"type":"lease","holder":"free"|"self"|"driver"|"other","name":..,"refused":b}
 *                 {"type":"capture","id","text","error"}
 *                 {"type":"command","id","error"}
 *                 {"type":"error","error"}
 *
 *               A connection without cols/rows is an older client: it is subscribed at 120x32,
 *               which is logged, and since it never acknowledges, the server acknowledges each
 *               chunk on its behalf as the pump writes it to the socket.
 *
 *               "refused" is how a viewer learns its input or take was turned down: the
 *               connector answers a refusal by repeating the lease holder it last told that
 *               viewer, so the same holder twice in a row — held by somebody else — is a refusal.
 *
 *               ScreenAttachPreflight  beforeAttach(sid) -> the sid to attach to (see below).
 *               ViewerHandler(hub, objectMapper, profiles, preflight?) — registered by
 *               ConnectorWebSocketConfig; Spring calls its WebSocket callbacks.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.machine.screen

import app.microteams.machine.link.HubViewer
import app.microteams.machine.link.MachineHub
import app.microteams.machine.link.ViewerSink
import app.microteams.user.UserProfileRepository
import java.nio.ByteBuffer
import java.util.UUID
import java.util.concurrent.CompletionException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import org.rucca.cheese.common.persistent.IdType
import org.slf4j.LoggerFactory
import org.springframework.web.socket.BinaryMessage
import org.springframework.web.socket.CloseStatus
import org.springframework.web.socket.TextMessage
import org.springframework.web.socket.WebSocketSession
import org.springframework.web.socket.handler.AbstractWebSocketHandler
import tools.jackson.databind.ObjectMapper

/**
 * Asked, just before a viewer attaches, whether anything needs doing to the screen first — the
 * machine layer has no idea what runs on one, so what "needs doing" means belongs to the module
 * that opened it (for agents: waking a program known dead). It must not wait on the machine. It
 * returns the sid to actually attach to, which is normally the one passed in.
 */
fun interface ScreenAttachPreflight {
    fun beforeAttach(sid: String): String
}

/** The room an older client that says nothing about its size is given. */
private const val LEGACY_COLS = 120
private const val LEGACY_ROWS = 32

/** How long a command call waits for the applet before the viewer is told it failed. */
private const val COMMAND_TIMEOUT_SECONDS = 10L

/** The applet functions a viewer may call. */
private val COMMANDS = setOf("usage", "compact")

class ViewerHandler(
    private val hub: MachineHub,
    private val objectMapper: ObjectMapper,
    private val profiles: UserProfileRepository,
    private val preflight: ScreenAttachPreflight? = null,
) : AbstractWebSocketHandler() {
    private val logger = LoggerFactory.getLogger(ViewerHandler::class.java)

    private inner class Viewer(
        val sid: String,
        val id: String,
        val pump: ViewerPump,
    ) : ViewerSink {
        @Volatile var lastHolder: String? = null

        fun text(frame: Map<String, Any?>) {
            pump.offer(ViewerFrame.Text(objectMapper.writeValueAsString(frame)))
        }

        override fun bytes(data: ByteArray) {
            pump.offer(ViewerFrame.Bytes(data))
        }

        override fun size(cols: Int, rows: Int) =
            text(mapOf("type" to "size", "cols" to cols, "rows" to rows))

        override fun lease(holder: String) {
            val refused = holder == lastHolder && holder != "" && holder != id
            lastHolder = holder
            val (kind, name) =
                when (holder) {
                    "" -> "free" to null
                    "driver" -> "driver" to null
                    id -> "self" to null
                    else -> "other" to nicknames[holder]
                }
            text(mapOf("type" to "lease", "holder" to kind, "name" to name, "refused" to refused))
        }

        override fun capture(id: String, text: String?, error: String?) =
            text(mapOf("type" to "capture", "id" to id, "text" to text, "error" to error))

        override fun error(text: String) = text(mapOf("type" to "error", "error" to text))
    }

    /** session id -> its viewer. */
    private val viewers = ConcurrentHashMap<String, Viewer>()

    /** viewer id -> the nickname of the person behind it, for "who is typing". */
    private val nicknames = ConcurrentHashMap<String, String>()

    override fun afterConnectionEstablished(session: WebSocketSession) {
        // The handshake authorized this human against the sid they asked for; the preflight may
        // hand back a different one, but only ever another screen of the SAME owner, so the
        // authorization that was granted still covers what we attach to.
        val asked = session.attributes["sid"] as? String
        val sid = asked?.let { preflight?.beforeAttach(it) ?: it }
        val screen = sid?.let { hub.screen(it) }
        if (screen == null) {
            logger.error("live screen: no screen '{}' to attach to (asked for '{}')", sid, asked)
            session.close(CloseStatus.POLICY_VIOLATION.withReason("screen not found"))
            return
        }
        session.binaryMessageSizeLimit = 1 shl 20
        session.textMessageSizeLimit = 1 shl 20
        val cols = session.attributes["cols"] as? Int
        val rows = session.attributes["rows"] as? Int
        val acks = cols != null && rows != null
        if (!acks) {
            logger.info(
                "live screen: viewer {} of {} sent no size (an older client); {}x{}, acknowledged by the server",
                session.id,
                screen.sid,
                LEGACY_COLS,
                LEGACY_ROWS,
            )
        }
        val id = "v" + UUID.randomUUID().toString().replace("-", "").take(8)
        // Every frame goes through this viewer's own queue and thread: the hub calls the sink on
        // the machine's receive thread, which must never wait on a browser (see ViewerPump).
        val pump =
            ViewerPump(
                label = session.id,
                write = { frame ->
                    synchronized(session) {
                        if (!session.isOpen) return@synchronized
                        when (frame) {
                            is ViewerFrame.Bytes ->
                                session.sendMessage(BinaryMessage(ByteBuffer.wrap(frame.data)))
                            is ViewerFrame.Text -> session.sendMessage(TextMessage(frame.json))
                        }
                    }
                    if (!acks && frame is ViewerFrame.Bytes)
                        hub.viewerAck(screen.sid, id, frame.size)
                },
                giveUp = {
                    logger.warn("live screen: closing viewer {} — it could not keep up", session.id)
                    try {
                        session.close(CloseStatus.SESSION_NOT_RELIABLE)
                    } catch (e: Exception) {
                        logger.debug(
                            "live screen: closing viewer {} failed: {}",
                            session.id,
                            e.toString(),
                        )
                    }
                },
            )
        val viewer = Viewer(screen.sid, id, pump)
        viewers[session.id] = viewer
        (session.attributes["userId"] as? IdType)?.let { nicknames[id] = nicknameOf(it) }
        hub.attachViewer(
            screen.sid,
            HubViewer(id, viewer, cols ?: LEGACY_COLS, rows ?: LEGACY_ROWS),
        )
    }

    private fun nicknameOf(userId: IdType): String =
        profiles.findByUserId(userId.toInt()).map { it.nickname }.orElse(null) ?: "user$userId"

    override fun handleBinaryMessage(session: WebSocketSession, message: BinaryMessage) {
        val viewer = viewers[session.id] ?: return
        val buf = message.payload
        val data = ByteArray(buf.remaining()).also { buf.get(it) }
        hub.viewerInput(viewer.sid, viewer.id, data)
    }

    override fun handleTextMessage(session: WebSocketSession, message: TextMessage) {
        val viewer = viewers[session.id] ?: return
        val msg =
            try {
                objectMapper.readTree(message.payload)
            } catch (e: Exception) {
                return
            }
        val sid = viewer.sid
        when (msg.path("type").asText()) {
            "resize" -> {
                val cols = msg.path("cols").asInt(0)
                val rows = msg.path("rows").asInt(0)
                if (cols > 0 && rows > 0) hub.viewerResize(sid, viewer.id, cols, rows)
            }
            "ack" -> hub.viewerAck(sid, viewer.id, msg.path("n").asInt(0))
            "lease" -> hub.viewerLease(sid, viewer.id, msg.path("op").asText())
            "capture" -> hub.viewerCapture(sid, viewer.id, msg.path("id").asText())
            "command" -> command(viewer, msg.path("id").asText(), msg.path("name").asText())
            "compact" ->
                hub.screen(sid)?.let { hub.callScreen(it.machineId, sid, "compact", emptyList()) }
            "control" -> hub.viewerControl(sid, msg.path("level").asText("passive"))
            "scroll" -> hub.viewerScroll(sid, msg.path("dir").asText("bottom"))
        }
    }

    /** Call an applet function for the viewer and tell it the outcome, without waiting here. */
    private fun command(viewer: Viewer, id: String, name: String) {
        fun reply(error: String?) =
            viewer.text(mapOf("type" to "command", "id" to id, "error" to error))
        val screen = hub.screen(viewer.sid)
        if (name !in COMMANDS) return reply("unknown command '$name'")
        if (screen == null) return reply("the screen is gone")
        hub.callScreen(screen.machineId, screen.sid, name, emptyList())
            .orTimeout(COMMAND_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .whenCompleteAsync { _, e ->
                val cause = (e as? CompletionException)?.cause ?: e
                reply(
                    when (cause) {
                        null -> null
                        is TimeoutException -> "the machine did not answer"
                        else -> cause.message ?: cause.javaClass.simpleName
                    },
                )
            }
    }

    override fun afterConnectionClosed(session: WebSocketSession, status: CloseStatus) {
        val viewer = viewers.remove(session.id) ?: return
        // Stop the pump first: with the socket already gone, anything still queued would only
        // produce write errors, and its thread must not outlive the viewer.
        viewer.pump.close()
        nicknames.remove(viewer.id)
        hub.detachViewer(viewer.sid, viewer.id)
    }
}
