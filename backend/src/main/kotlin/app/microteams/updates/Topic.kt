/*
 *  Description: What a client can subscribe to, spelled exactly once.
 *
 *               A topic is three things at the same time: the unit of subscription, the unit of
 *               authorization, and the thing a cursor counts along. Keeping the string "thread:12"
 *               assembled and parsed in this one file is what stops the third meaning from drifting
 *               away from the first two.
 *
 *               Only `thread:` exists today. The rest of the table in
 *               todo/microteams/realtime-ws.md §3 (chats, agent, machines, docs, screen) lands one
 *               at a time, and the landing order there is deliberate: one topic first, with the
 *               polling left alone, so the whole chain is proven before anything is taken away.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.updates

sealed interface Topic {
    /** The wire form. The only place a topic string is built. */
    val name: String

    /** Messages appearing, changing or going away in one thread. Cursor: the message id. */
    data class Thread(val threadId: Long) : Topic {
        override val name: String = "$PREFIX$threadId"

        companion object {
            const val PREFIX = "thread:"
        }
    }

    companion object {
        /** Parse a wire topic. Null for anything unknown or malformed — never an exception. */
        fun parse(raw: String): Topic? {
            if (raw.startsWith(Thread.PREFIX)) {
                val id = raw.removePrefix(Thread.PREFIX).toLongOrNull() ?: return null
                return Thread(id)
            }
            return null
        }
    }
}
