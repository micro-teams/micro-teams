/*
 *  Description: What a topic IS, declared once per kind.
 *
 *               The change in wording matters more than the code: a topic is not "a channel events
 *               are sent on", it is *a named query whose result a client keeps in sync*. Everything
 *               the engine does follows from that — the cursor says how far that result has moved,
 *               the digest says what the result should look like right now, and a client that
 *               disagrees with either refetches.
 *
 *               A feature author writes one of these and nothing else. Publishing, replay, gap
 *               decisions, re-authorization on every send, and the periodic verification are the
 *               engine's business, and no business code anywhere calls into the updates package.
 *
 *               Two of the four members exist to make specific mistakes impossible rather than
 *               merely discouraged:
 *
 *               `digest` MUST be computed by asking the data source — never from what this server
 *               remembers publishing. A digest derived from our own published cursor agrees with
 *               itself forever, including in the exact case worth catching: a write that happened
 *               while nobody emitted an event for it (a mapping nobody wrote, a bulk update that
 *               bypasses entity events, a predicate that filters too much). That failure looks
 *               perfectly healthy from every other angle, and this is the only thing that sees it.
 *               Returning null means "I cannot answer right now", which is NOT the same as "no
 *               change" and must never be reported as agreement.
 *
 *               `mayRead` asks whichever module owns the concept. It does not decide anything
 *               itself, for the same reason RolePermissionService exists: nobody should have to
 *               read the push layer to learn who can see what.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.updates

/**
 * One kind of topic: how its name is written, who may read it, and what its result looks like now.
 *
 * `prefix` is the only place a topic's wire spelling is decided, so "thread:12" is built and parsed
 * by the same declaration and cannot drift apart.
 */
interface SyncedQuery<T : Topic> {
    val prefix: String

    /** Parse the part after the prefix. Null for anything malformed — never an exception. */
    fun parse(raw: String): T?

    fun mayRead(userId: Long, topic: T): Boolean

    /**
     * The current state of this query's result, asked of the data source.
     *
     * Null means "cannot answer" (the row is gone, the store is unreachable): the verifier stays
     * quiet rather than claiming agreement. What a digest can and cannot detect is decided entirely
     * by what goes into it, so each implementation says so in its own doc comment — that statement
     * is the guarantee this whole mechanism offers.
     */
    fun digest(topic: T): TopicState?
}

/**
 * Where a query's result stands: how far it has moved, and what it looks like.
 *
 * `seq` is the same number the client pages with (for a thread, the message id), so "you are at
 * 9134" needs no translation and cannot drift out of step with the fetch path.
 */
data class TopicState(val seq: Long, val digest: String)

/**
 * Every declared query, looked up by topic prefix.
 *
 * A `SyncedQuery` bean is discovered here rather than registered by hand, so a new topic cannot be
 * half-added: the declaration IS the registration.
 */
class TopicCatalog(queries: List<SyncedQuery<*>>) {
    private val byPrefix = queries.associateBy { it.prefix }

    fun queryFor(topic: Topic): SyncedQuery<Topic>? {
        @Suppress("UNCHECKED_CAST")
        return byPrefix[topic.prefix] as SyncedQuery<Topic>?
    }

    /** Parse a wire topic through whichever declaration owns its prefix. */
    fun parse(raw: String): Topic? {
        val query = byPrefix.entries.firstOrNull { raw.startsWith(it.key) }?.value ?: return null
        return query.parse(raw)
    }

    fun mayRead(userId: Long, topic: Topic): Boolean =
        queryFor(topic)?.mayRead(userId, topic) == true

    fun digest(topic: Topic): TopicState? = queryFor(topic)?.digest(topic)
}
