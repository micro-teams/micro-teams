/*
 *  Description: The topics themselves — the identity half of a synced query.
 *
 *               A topic is three things at once: what you subscribe to, what you are authorized
 *               for, and what a cursor counts along. Keeping its wire spelling in one place is what
 *               stops those three meanings from drifting apart.
 *
 *               How a topic behaves — who may read it, what its result looks like — is NOT here. It
 *               lives in the SyncedQuery declaration that owns the prefix (see map/), so a topic
 *               cannot exist without something that can authorize and verify it.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.updates

sealed interface Topic {
    /** The wire form. The only place a topic string is built. */
    val name: String

    /** Which declaration owns this topic. */
    val prefix: String

    /** Messages appearing, changing or going away in one thread. Cursor: the message id. */
    data class Thread(val threadId: Long) : Topic {
        override val name: String = "$PREFIX$threadId"
        override val prefix: String = PREFIX

        companion object {
            const val PREFIX = "thread:"
        }
    }

    /**
     * The chat list as one user sees it: which groups, in what order, with which last message.
     * Cursor: the newest message id across that user's groups, which is what reorders the list.
     */
    data class Chats(val userId: Long) : Topic {
        override val name: String = "$PREFIX$userId"
        override val prefix: String = PREFIX

        companion object {
            const val PREFIX = "chats:"
        }
    }

    /**
     * The agents and machines serving one team — who exists, who is online, what they are on.
     * Cursor: a counter, because liveness lives in memory rather than in any row with an id.
     */
    data class Team(val teamId: Long) : Topic {
        override val name: String = "$PREFIX$teamId"
        override val prefix: String = PREFIX

        companion object {
            const val PREFIX = "team:"
        }
    }
}
