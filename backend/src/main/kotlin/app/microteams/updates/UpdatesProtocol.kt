/*
 *  Description: The wire between the browser and the updates socket. This file is the one backend
 *               file the frontend has to be able to read on its own, so it says everything and
 *               depends on nothing.
 *
 *               The protocol pushes "something changed", never the thing that changed. That is the
 *               whole design decision (see todo/microteams/realtime-ws.md §1): the frontend already
 *               owns one set of rules for folding fetched data into what it holds, and pushing
 *               objects would create a second write path whose merge semantics must agree with the
 *               first one forever — and when they disagree nothing looks wrong, the list is simply
 *               missing a message. Pushing "topic X moved to cursor N" instead makes a lost, a
 *               duplicated, or an out-of-order event cost exactly one redundant fetch. This is a
 *               protocol that is allowed to be wrong, which is the only kind worth trusting.
 *
 *               `v` only ever increases, like the connector's link protocol. An unrecognised `kind`
 *               (or frame type) MUST be ignored in silence at both ends: the browser can be older
 *               than the server (a cached Service Worker) and the server can be older than the
 *               browser (deploy order), and both directions have to keep working.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.updates

import com.fasterxml.jackson.annotation.JsonInclude

const val UPDATES_PROTOCOL_VERSION = 1

/** Server -> browser. */
@JsonInclude(JsonInclude.Include.NON_NULL)
data class UpdateFrame(
    val t: String,
    val v: Int = UPDATES_PROTOCOL_VERSION,
    /** `event`: the topic that moved, and how far. */
    val topic: String? = null,
    val seq: Long? = null,
    /**
     * Where this topic stood immediately before this event. A client whose cursor is something else
     * missed a frame and refetches on the spot, rather than finding out at the next poll. Null the
     * first time we say anything about a topic — there is no earlier state to point at.
     */
    val prev: Long? = null,
    val kind: String? = null,
    /** `state`: what the query's result should look like right now, asked of the data source. */
    val digest: String? = null,
    /** `ack`: which topics were granted, and where each stands now. */
    val granted: List<String>? = null,
    val refused: List<String>? = null,
    val cursors: Map<String, Long>? = null,
    /** `gap`: this topic moved too far to catch up from; refetch it whole. */
    val message: String? = null,
) {
    companion object {
        fun event(topic: String, seq: Long, prev: Long?, kind: String) =
            UpdateFrame(t = "event", topic = topic, seq = seq, prev = prev, kind = kind)

        /**
         * The periodic "your copy should look like this" frame. It is what makes silence mean
         * something: without it, a topic that is quiet and a topic whose events are never being
         * published look exactly alike.
         */
        fun state(topic: String, seq: Long, digest: String) =
            UpdateFrame(t = "state", topic = topic, seq = seq, digest = digest)

        fun ack(granted: List<String>, refused: List<String>, cursors: Map<String, Long>) =
            UpdateFrame(t = "ack", granted = granted, refused = refused, cursors = cursors)

        /** `seq` may be null: "refetch, and tell me where you land" is a legitimate answer. */
        fun gap(topic: String, seq: Long?) = UpdateFrame(t = "gap", topic = topic, seq = seq)

        fun pong() = UpdateFrame(t = "pong")

        fun err(message: String) = UpdateFrame(t = "err", message = message)
    }
}

/**
 * Browser -> server. One shape for every client frame: unknown fields are ignored by Jackson, and a
 * frame whose `t` we do not recognise is dropped without a word (see the version note above).
 */
data class ClientFrame(
    val t: String? = null,
    val topics: List<String>? = null,
    /** Where the client believes each topic stood, so a reconnect can be told what it missed. */
    val since: Map<String, Long>? = null,
)

/** The kinds a topic can report. Additive only — an old client ignores what it does not know. */
object UpdateKind {
    const val MESSAGE_CREATED = "message.created"
    const val CHATS_CHANGED = "chats.changed"
    const val TEAM_CHANGED = "team.changed"
}
