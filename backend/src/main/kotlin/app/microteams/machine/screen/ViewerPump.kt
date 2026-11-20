/*
 *  Description: One browser viewer's outbound queue, and the reason it exists.
 *
 *               What a viewer is told reaches it on the machine's control-channel receive thread
 *               (LinkHandler -> MachineHub.onMachineMessage -> the viewer's ViewerSink). Writing to
 *               the browser's WebSocket there would let a viewer that cannot keep up stall that
 *               thread, and with it everything else the machine says: other screens' data, rpc
 *               results, variables, screenReady. So the machine thread only hands frames to this
 *               queue and returns; one thread per viewer does the blocking write.
 *
 *               Flow control is the connector's: a protocol 2 viewer acknowledges what it has
 *               rendered, and the connector stops reading a viewer's client while 256 KiB are
 *               unacknowledged, so this queue stays short. It is bounded anyway, for a protocol 1
 *               machine (no flow control) and for a browser that stops reading. Dropping bytes
 *               would be wrong — the stream is escape sequences mutating a parser, and a hole can
 *               leave the picture wrong for good — so past `capacityBytes` the viewer is hung up
 *               on. Its client dials again, and a fresh subscription is a full repaint.
 *
 *               Text frames (the viewer's size, lease state, capture and command answers) go
 *               through the same queue as the bytes, so a size is never overtaken by the data drawn
 *               at that size, nor the other way round.
 *
 *               ViewerFrame.Bytes(data) / ViewerFrame.Text(json)  one outbound frame.
 *               VIEWER_QUEUE_BYTES  the default capacityBytes.
 *               ViewerPump(label, capacityBytes?, write, giveUp, startThread?)
 *                 offer(frame) -> false once given up; close(); backlogBytes(); isClosed().
 *
 *               Example: val pump = ViewerPump("v1", write = { send(it) }, giveUp = { close() })
 *                        pump.offer(ViewerFrame.Text("""{"type":"size","cols":80,"rows":24}"""))
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.machine.screen

import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import org.slf4j.LoggerFactory

/** One frame to a viewer: screen bytes (a binary frame) or a JSON text frame. */
sealed interface ViewerFrame {
    val size: Int

    class Bytes(val data: ByteArray) : ViewerFrame {
        override val size: Int
            get() = data.size
    }

    class Text(val json: String) : ViewerFrame {
        override val size: Int
            get() = json.length
    }
}

/**
 * How many bytes of frames a viewer may owe — accepted by [ViewerPump.offer], not yet written —
 * before it is hung up on. Far above what acknowledged flow control lets build up.
 */
const val VIEWER_QUEUE_BYTES: Int = 4 * 1024 * 1024

class ViewerPump(
    private val label: String,
    private val capacityBytes: Int = VIEWER_QUEUE_BYTES,
    /** The blocking write. Called only from this pump's own thread, never from a caller's. */
    private val write: (ViewerFrame) -> Unit,
    /**
     * Tear the viewer down — in production, close its WebSocket. Called at most once, never on the
     * caller's thread and never on the pump's own: a blocked write must not delay the hang-up, and
     * closing the session is in fact how that write gets unblocked.
     */
    private val giveUp: () -> Unit,
    /** Overridable so tests can run the loop and the hang-up on threads they control. */
    private val startThread: (String, Runnable) -> Unit = { name, r ->
        Thread(r, name).also { it.isDaemon = true }.start()
    },
) {
    private val logger = LoggerFactory.getLogger(ViewerPump::class.java)

    private val queue = LinkedBlockingQueue<ViewerFrame>()
    private val queued = AtomicInteger(0)
    private val closed = AtomicBoolean(false)
    /** Ends the loop; compared by identity, so no real frame can mean "stop". */
    private val poison: ViewerFrame = ViewerFrame.Bytes(ByteArray(0))

    init {
        startThread("viewer-pump-$label", Runnable { run() })
    }

    /**
     * Hand over bytes to be written. Never blocks and never throws: the caller is the machine's
     * receive thread, which has no business waiting on a browser or handling its errors.
     *
     * Returns false once the viewer has been given up on, so a caller that keeps a viewer list can
     * drop it — but nothing depends on the caller noticing, since the pump closes the session too.
     */
    fun offer(frame: ViewerFrame): Boolean {
        if (closed.get()) return false
        if (frame.size == 0) return true
        val total = queued.addAndGet(frame.size)
        if (total > capacityBytes) {
            // Hopelessly behind. Do not try to catch up by discarding part of the stream — see the
            // file header for why a hole is worse than a hang-up.
            logger.warn(
                "live screen: viewer {} is {} bytes behind (limit {}), closing it; it will reconnect and repaint",
                label,
                total,
                capacityBytes,
            )
            stop(hangUp = true)
            return false
        }
        queue.put(frame) // unbounded queue: put() cannot block
        return true
    }

    /**
     * Stop the pump without hanging up — the viewer is going away for its own reasons (it
     * disconnected, or the screen detached it). Idempotent, safe from any thread.
     */
    fun close() = stop(hangUp = false)

    private fun stop(hangUp: Boolean) {
        if (!closed.compareAndSet(false, true)) return
        queue.put(poison)
        if (!hangUp) return
        // On its own thread on purpose: the pump may be parked inside a write that only the
        // session's close will release, and the caller here may be the machine's receive thread.
        startThread(
            "viewer-hangup-$label",
            Runnable {
                try {
                    giveUp()
                } catch (e: Exception) {
                    logger.debug("live screen: viewer {} hang-up failed: {}", label, e.toString())
                }
            },
        )
    }

    /** Bytes accepted but not yet written. Test seam. */
    fun backlogBytes(): Int = queued.get()

    fun isClosed(): Boolean = closed.get()

    private fun run() {
        while (true) {
            val next =
                try {
                    queue.take()
                } catch (e: InterruptedException) {
                    Thread.currentThread().interrupt()
                    return
                }
            if (next === poison) return
            queued.addAndGet(-next.size)
            try {
                write(next)
            } catch (e: Exception) {
                // The socket is gone, or refused the frame. Nothing here can fix that: stop
                // writing and hang the viewer up so it reconnects onto a repainted screen.
                logger.debug(
                    "live screen: viewer {} write failed, stopping pump: {}",
                    label,
                    e.toString(),
                )
                stop(hangUp = true)
                return
            }
        }
    }
}
