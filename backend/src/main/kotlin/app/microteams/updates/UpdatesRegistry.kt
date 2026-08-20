/*
 *  Description: Who is subscribed to what, where each query's result stands, and what a
 *               reconnecting client missed. I/O-free on purpose — no Spring, no WebSocket, no
 *               database — so the awkward cases (a reconnect that can be caught up, one that
 *               cannot, a server that is itself behind, a user who lost access while away) are
 *               tested directly instead of through a socket.
 *
 *               Three rules here are load-bearing, and each exists because of a specific way this
 *               could lie to a client:
 *
 *               1. **The cursor can be unknown.** After a restart this server remembers nothing,
 *                  while browsers still hold the cursors they had. Treating "I have no record" as
 *                  "nothing has happened" would answer a client holding 9134 with a cheerful "you
 *                  are up to date" — which is false and silent. Unknown answers `gap`.
 *
 *               2. **A client ahead of us means WE are stale, not the client.** Same situation seen
 *                  from the other side, and the honest response is again `gap`: refetch and tell us
 *                  where you land. Assuming the client is wrong is how a fresh server convinces
 *                  every browser to forget messages it already has.
 *
 *               3. **Every event carries `prev`.** Message ids are not contiguous, so a client
 *                  receiving 9134 cannot otherwise tell whether 9120 happened. With `prev` a hole
 *                  in the stream is detected on the very next frame instead of at the next poll.
 *                  Worth being precise about the limit: this catches frames lost in transit, and
 *                  cannot catch an event that was never published at all — in that case our cursor
 *                  did not move either, so the chain stays perfectly consistent. That failure is
 *                  what TopicVerifier is for.
 *
 *               Everything is in memory, which is legitimate only because this backend must run as
 *               a single instance anyway (MultiPath's write de-duplication is in-process). Written
 *               down because the ring and the subscription table are the first things that break if
 *               that stops being true.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.updates

import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList

/** How many events per topic are kept for catching a reconnecting client up. */
const val UPDATES_RING_SIZE = 256

/** One connected browser, from the registry's point of view. */
interface UpdatesSink {
    val userId: Long

    /** Deliver a frame. Must not block the caller; implementations queue. */
    fun send(frame: UpdateFrame)
}

data class RecordedEvent(val topic: String, val seq: Long, val prev: Long?, val kind: String)

class UpdatesRegistry(private val ringSize: Int = UPDATES_RING_SIZE) {

    private class TopicState {
        val subscribers = CopyOnWriteArrayList<UpdatesSink>()
        val ring = ArrayDeque<RecordedEvent>()

        /** Null until something tells us where this topic stands. Not the same as zero. */
        @Volatile var cursor: Long? = null
    }

    private val topics = ConcurrentHashMap<String, TopicState>()

    private fun state(topic: String) = topics.computeIfAbsent(topic) { TopicState() }

    /** Where this topic stands, or null if we genuinely do not know. */
    fun cursorOf(topic: String): Long? = topics[topic]?.cursor

    fun subscriberCount(topic: String): Int = topics[topic]?.subscribers?.size ?: 0

    /** Topics with at least one listener — the only ones worth verifying. */
    fun activeTopics(): List<String> =
        topics.entries.filter { it.value.subscribers.isNotEmpty() }.map { it.key }

    /**
     * Adopt a cursor learned from the data source (the verifier asks; a restart is why it must).
     * Only ever moves forward: our own published events are equally authoritative.
     */
    fun seedCursor(topic: String, seq: Long) {
        val st = state(topic)
        val at = st.cursor
        if (at == null || seq > at) st.cursor = seq
    }

    /**
     * Subscribe a sink and, if it says where it left off, tell it what it missed.
     *
     * Returns the topic's cursor, or null if unknown, so the caller can put it in the ack — a
     * client told where it stands can notice a disagreement, which is a bug report; a client told
     * nothing can only guess.
     */
    fun subscribe(topic: String, sink: UpdatesSink, since: Long?): Long? {
        val st = state(topic)
        if (!st.subscribers.contains(sink)) st.subscribers.add(sink)
        if (since != null) catchUp(st, topic, since, sink)
        return st.cursor
    }

    private fun catchUp(st: TopicState, topic: String, since: Long, sink: UpdatesSink) {
        val cursor = st.cursor
        // We have no record (a restart), or the client is ahead of us. Either way we cannot
        // honestly
        // say "you are current", and a gap costs one refetch.
        if (cursor == null || since > cursor) {
            sink.send(UpdateFrame.gap(topic, cursor))
            return
        }
        if (since == cursor) return // nothing missed
        val (oldest, missed) =
            synchronized(st.ring) {
                st.ring.firstOrNull()?.seq to st.ring.filter { it.seq > since }
            }
        // We can only catch them up if the ring still reaches back to where they were. If its
        // oldest
        // entry is already newer, something fell off the end and we cannot know what.
        if (oldest == null || oldest > since) {
            sink.send(UpdateFrame.gap(topic, cursor))
            return
        }
        missed.forEach { sink.send(UpdateFrame.event(topic, it.seq, it.prev, it.kind)) }
    }

    fun unsubscribe(topic: String, sink: UpdatesSink) {
        topics[topic]?.subscribers?.remove(sink)
    }

    /** Drop a sink from every topic — the connection went away. */
    fun forget(sink: UpdatesSink) {
        topics.values.forEach { it.subscribers.remove(sink) }
    }

    /**
     * Record that a query's result moved and tell everyone watching it.
     *
     * `stillAllowed` is asked per subscriber, every time, rather than trusted from subscription
     * time: someone removed from a group must stop hearing it at once, and "they were allowed when
     * they subscribed" is a different statement from "they are allowed now".
     */
    fun publish(
        topic: String,
        seq: Long,
        kind: String,
        stillAllowed: (Long) -> Boolean = { true },
    ) {
        val st = state(topic)
        val prev = st.cursor
        if (prev != null && seq <= prev) return // already told, or older than what we have said
        val event = RecordedEvent(topic, seq, prev, kind)
        synchronized(st.ring) {
            st.ring.addLast(event)
            while (st.ring.size > ringSize) st.ring.removeFirst()
        }
        st.cursor = seq
        val frame = UpdateFrame.event(topic, seq, prev, kind)
        for (sink in st.subscribers) {
            if (!stillAllowed(sink.userId)) {
                st.subscribers.remove(sink)
                continue
            }
            sink.send(frame)
        }
    }

    /** Send one frame to everyone watching a topic (the verifier's `state`). */
    fun broadcast(topic: String, frame: UpdateFrame) {
        topics[topic]?.subscribers?.forEach { it.send(frame) }
    }
}
