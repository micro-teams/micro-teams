package app.microteams

import io.ktor.client.plugins.websocket.DefaultClientWebSocketSession
import io.ktor.client.plugins.websocket.webSocket
import io.ktor.websocket.Frame
import io.ktor.websocket.close
import io.ktor.websocket.readBytes
import io.ktor.websocket.send
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch

/**
 * A live screen: raw machine bytes in, raw keystrokes out. Deliberately not a terminal emulator —
 * v0 shows the scrollback as plain decoded text and lets a person send one line at a time, which is
 * "can open the terminal" without yet being "xterm.dart's replacement". See the migration backlog
 * for the real VT100 rendering work (BossTerm on Android, xterm.js embed on web).
 */
class TerminalSession(private val api: ApiClient, private val sid: String) {
    /** Decoded output text, one element per frame the machine sent. */
    val output = Channel<String>(Channel.UNLIMITED)
    private var session: DefaultClientWebSocketSession? = null

    fun connect(scope: CoroutineScope) {
        scope.launch {
            api.ws.webSocket(api.screenSocketUrl(sid)) {
                session = this
                send(Frame.Text("""{"type":"control","level":"full"}"""))
                try {
                    for (frame in incoming) {
                        if (frame is Frame.Binary) {
                            output.send(frame.readBytes().decodeToString())
                        }
                    }
                } finally {
                    session = null
                }
            }
        }
    }

    suspend fun sendLine(text: String) {
        session?.send(Frame.Binary(true, (text + "\n").encodeToByteArray()))
    }

    suspend fun close() {
        session?.close()
    }
}
