/*
 *  Description: Who is subscribed to what, where each topic stands, and what a reconnecting client
 *               missed. I/O-free on purpose — no Spring, no WebSocket, no database — so the awkward
 *               parts (a reconnect that can be caught up, one that cannot, a user who lost access
 *               while away) are tested directly instead of through a socket.
 *
 *               Two things live here and they are deliberately separate:
 *
 *               **Where a topic stands** is a cursor, and for threads it is the message id rather
 *               than a counter of our own. Reusing the id means the pagination cursor the frontend
 *               already understands is the same number the socket talks about, so "you are at 9134"
 *               needs no translation and cannot drift.
 *
 *               **What happened recently** is a small ring per topic. A client that reconnects
 *               saying `since` gets the events it missed if they are still in the ring, and a single
 *               `gap` frame if they are not. That is the point: three seconds offline and three
 *               hours offline take different code paths instead of the same hopeful one.
 *
 *               Everything in memory, which is legitimate only because this backend must run as a
 *               single instance anyway (MultiPath's write de-duplication is in-process). Writing it
 *               down because the ring and the subscription table are the first things that break if
 *               that ever stops being true.
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

data class RecordedEvent(val topic: String, val seq: Long, val kind: String)

class UpdatesRegistry(private val ringSize: Int = UPDATES_RING_SIZE) {

    private class TopicState {
        val subscribers = CopyOnWriteArrayList<UpdatesSink>()
        val ring = ArrayDeque<RecordedEvent>()
        @Volatile var cursor: Long = 0
    }

    private val topics = ConcurrentHashMap<String, TopicState>()

    private fun state(topic: String) = topics.computeIfAbsent(topic) { TopicState() }

    /** Where this topic stands right now. Zero means "nothing has happened that we know of". */
    fun cursorOf(topic: String): Long = topics[topic]?.cursor ?: 0

    fun subscriberCount(topic: String): Int = topics[topic]?.subscribers?.size ?: 0

    /**
     * Subscribe a sink and, if it says where it left off, replay what it missed.
     *
     * Replay happens here rather than in the handler because deciding "can this be caught up, or is
     * it a gap" needs the ring, and the ring is the thing this class owns. Returns the topic's
     * current cursor so the caller can put it in the ack — a client that is told where it stands
     * can notice a disagreement, which is a bug report; a client that is told nothing can only
     * guess.
     */
    fun subscribe(topic: String, sink: UpdatesSink, since: Long?): Long {
        val st = state(topic)
        if (!st.subscribers.contains(sink)) st.subscribers.add(sink)
        if (since != null && since < st.cursor) replay(st, topic, since, sink)
        return st.cursor
    }

    private fun replay(st: TopicState, topic: String, since: Long, sink: UpdatesSink) {
        val (oldest, missed) =
            synchronized(st.ring) {
                st.ring.firstOrNull()?.seq to st.ring.filter { it.seq > since }
            }
        // We can only catch them up if the ring still reaches back to where they were. If its
        // oldest
        // entry is already newer than that, something fell off the end and we cannot know what, so
        // say so once and let them refetch the topic whole. Guessing here would silently lose a
        // message, which is the exact failure this protocol exists to make impossible.
        if (oldest == null || oldest > since) {
            sink.send(UpdateFrame.gap(topic, st.cursor))
            return
        }
        missed.forEach { sink.send(UpdateFrame.event(topic, it.seq, it.kind)) }
    }

    fun unsubscribe(topic: String, sink: UpdatesSink) {
        topics[topic]?.subscribers?.remove(sink)
    }

    /** Drop a sink from every topic — the connection went away. */
    fun forget(sink: UpdatesSink) {
        topics.values.forEach { it.subscribers.remove(sink) }
    }

    /**
     * Record that a topic moved and tell everyone subscribed to it.
     *
     * `stillAllowed` is asked per subscriber, every time, rather than trusted from subscription
     * time: someone removed from a group must stop hearing it at once, and "they were allowed when
     * they subscribed" is not the same statement.
     */
    fun publish(
        topic: String,
        seq: Long,
        kind: String,
        stillAllowed: (Long) -> Boolean = { true },
    ) {
        val st = state(topic)
        val event = RecordedEvent(topic, seq, kind)
        synchronized(st.ring) {
            st.ring.addLast(event)
            while (st.ring.size > ringSize) st.ring.removeFirst()
        }
        if (seq > st.cursor) st.cursor = seq
        val frame = UpdateFrame.event(topic, seq, kind)
        for (sink in st.subscribers) {
            if (!stillAllowed(sink.userId)) {
                st.subscribers.remove(sink)
                continue
            }
            sink.send(frame)
        }
    }
}
