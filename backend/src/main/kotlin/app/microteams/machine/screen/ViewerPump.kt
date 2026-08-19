/*
 *  Description: One browser viewer's outbound queue, and the reason it exists.
 *
 *               Screen bytes reach a viewer on the machine's control-channel receive thread:
 *               LinkHandler.handleTextMessage -> MachineHub.onMachineMessage -> fanOutScreenData ->
 *               viewer.sendBytes. Writing to the browser's WebSocket *there* means a viewer that
 *               cannot keep up does not stall itself — it stalls that thread, and with it every
 *               other thing the machine is saying: other screens' data, rpc results, var updates,
 *               screenReady, exec results. A watcher on a slow relay could therefore freeze a whole
 *               machine, and the freeze looked exactly like "the agent stopped": nothing moved until
 *               something forced the pipe to drain, and any keystroke did (it travels the other
 *               direction, so it is never behind the jam, and the program repaints on input).
 *
 *               So the machine thread must never block on a browser. It hands bytes to this queue
 *               and returns immediately; one thread per viewer does the blocking write.
 *
 *               What to do when a viewer falls hopelessly behind is the interesting half. Dropping
 *               bytes out of a terminal stream is NOT a safe way to shed load: the stream is a
 *               sequence of escape sequences that mutate a state machine, so a hole in the middle
 *               does not cost you a frame, it can leave the parser (and the picture) wrong forever.
 *               Until the protocol can say "repaint everything" (the resync primitive this repo does
 *               not have yet), the only truthful options are block — which is what we are removing —
 *               or hang up. This hangs up: past `capacityBytes` of unwritten screen, the viewer is
 *               closed. The browser's reconnect loop dials again, and a reattach is a full repaint
 *               (a fresh tmux client paints the whole pane), so the picture comes back correct
 *               rather than subtly broken.
 *
 *               Caveat worth knowing: that reattach only repaints when the reconnecting viewer is
 *               the only one on the screen, because the hub subscribes on the first viewer alone.
 *               A second watcher still waits for the screen to change on its own. That is the same
 *               gap as the missing resync, and it is not fixed here.
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

/** How much unwritten screen a single viewer may owe before we give up on it. */
const val VIEWER_QUEUE_BYTES: Int = 4 * 1024 * 1024

class ViewerPump(
    private val label: String,
    private val capacityBytes: Int = VIEWER_QUEUE_BYTES,
    /** The blocking write. Called only from this pump's own thread, never from a caller's. */
    private val write: (ByteArray) -> Unit,
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

    private val queue = LinkedBlockingQueue<ByteArray>()
    private val queued = AtomicInteger(0)
    private val closed = AtomicBoolean(false)
    /** Ends the loop; a zero-length array is the only value that means "stop", never data. */
    private val poison = ByteArray(0)

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
    fun offer(bytes: ByteArray): Boolean {
        if (closed.get()) return false
        if (bytes.isEmpty()) return true
        val total = queued.addAndGet(bytes.size)
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
        queue.put(bytes) // unbounded queue: put() cannot block
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
