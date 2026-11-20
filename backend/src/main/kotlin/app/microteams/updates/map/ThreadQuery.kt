/*
 *  Description: The `thread:{id}` synced query — one conversation's messages.
 *
 *               This file is what a feature author writes, and all of it: name, who may read,
 *               what the answer looks like now, and a listener that says when it moved. The engine
 *               does the rest, and chat has never heard of any of this — no business method calls
 *               into the updates package, which is the only thing that stops "remember to notify
 *               the socket" from spreading into every feature.
 *
 *               WHAT THE DIGEST DETECTS, precisely, because a digest guarantees exactly what goes
 *               into it and nothing more. It is taken over the NEWEST PAGE — the same window the
 *               browser holds after opening a conversation — so both sides are describing the same
 *               set of messages rather than two overlapping ones:
 *
 *                 - a message arriving in this thread     -> yes, the newest id changes
 *                 - a message being deleted from the page -> yes, the count changes
 *                 - a message on the page found undelivered -> yes, ":u<n>" is appended, n being
 *                   how many (message, recipient) failures the page holds; a page with none
 *                   has no suffix
 *                 - a message being edited                -> NO
 *
 *               Edits are left out on purpose. The only way to include one is to compare a
 *               timestamp, and the two sides would have to render the same instant into the same
 *               string forever — a quiet, occasional disagreement of exactly the kind this
 *               mechanism exists to catch rather than manufacture. Nothing edits a message today;
 *               when something does, it should publish an event of its own, which is a better
 *               answer than a digest anyway.
 *
 *               A message found undelivered moves no cursor (no message arrived), so it is said
 *               with a `state` frame carrying the new digest, as ChatsQuery says a membership
 *               change: a client holding the old answer disagrees and refetches.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.updates.map

import app.microteams.chat.message.MessagePostedEvent
import app.microteams.chat.message.MessageRepository
import app.microteams.chat.message.MessageUndeliveredEvent
import app.microteams.chat.message.UndeliveredRepository
import app.microteams.chat.thread.ThreadMemberRepository
import app.microteams.updates.SyncedQuery
import app.microteams.updates.Topic
import app.microteams.updates.TopicState
import app.microteams.updates.UpdateFrame
import app.microteams.updates.UpdateKind
import app.microteams.updates.UpdatesRegistry
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import org.springframework.transaction.event.TransactionalEventListener

@Component
class ThreadQuery(
    private val registry: UpdatesRegistry,
    private val messageRepository: MessageRepository,
    private val undeliveredRepository: UndeliveredRepository,
    private val threadMemberRepository: ThreadMemberRepository,
) : SyncedQuery<Topic.Thread> {

    private val logger = LoggerFactory.getLogger(ThreadQuery::class.java)

    /**
     * The window the digest describes. Must stay equal to the frontend's PAGE_SIZE: the two sides
     * are only comparable while they are talking about the same messages.
     */
    private val DIGEST_PAGE = 100

    override val prefix = Topic.Thread.PREFIX

    override fun parse(raw: String): Topic.Thread? =
        raw.removePrefix(prefix).toLongOrNull()?.let { Topic.Thread(it) }

    override fun mayRead(userId: Long, topic: Topic.Thread): Boolean =
        threadMemberRepository.findByThreadIdAndUserId(topic.threadId, userId) != null

    /** Asked of the database, never of what we remember publishing — see SyncedQuery. */
    override fun digest(topic: Topic.Thread): TopicState {
        val page =
            messageRepository
                .findByThreadIdAndDeletedAtIsNullOrderByIdDesc(topic.threadId)
                .take(DIGEST_PAGE)
        if (page.isEmpty()) return TopicState(seq = 0, digest = "empty")
        val newestId = page.first().id ?: 0
        val undelivered = undeliveredRepository.findByMessageIdIn(page.mapNotNull { it.id }).size
        val suffix = if (undelivered > 0) ":u$undelivered" else ""
        return TopicState(seq = newestId, digest = "$newestId:${page.size}$suffix")
    }

    @TransactionalEventListener(fallbackExecution = true)
    fun onMessagePosted(event: MessagePostedEvent) {
        val id = event.messageId
        try {
            val members =
                threadMemberRepository
                    .findByThreadId(event.threadId)
                    .mapNotNull { it.userId }
                    .toSet()
            registry.publish(
                topic = Topic.Thread(event.threadId).name,
                seq = id,
                kind = UpdateKind.MESSAGE_CREATED,
                stillAllowed = { userId -> userId in members },
            )
        } catch (e: Exception) {
            // A push that fails must never take the message with it: a missed event costs one
            // refetch, and the verifier will notice within its interval anyway.
            logger.warn("updates: failed publishing thread {} change", event.threadId, e)
        }
    }

    @TransactionalEventListener(fallbackExecution = true)
    fun onMessageUndelivered(event: MessageUndeliveredEvent) {
        try {
            val topic = Topic.Thread(event.threadId)
            val state = digest(topic)
            registry.broadcast(topic.name, UpdateFrame.state(topic.name, state.seq, state.digest))
        } catch (e: Exception) {
            logger.warn(
                "updates: failed telling thread {} a message was undelivered",
                event.threadId,
                e,
            )
        }
    }
}
