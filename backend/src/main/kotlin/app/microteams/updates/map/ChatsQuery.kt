/*
 *  Description: The `chats:{userId}` synced query — one person's chat list.
 *
 *               Scoped to a user rather than to a group, because that is what the list is: the
 *               groups you belong to, ordered by what happened in them. A message in any of them
 *               moves it, so this listens to the same committed event the thread query does and
 *               fans it out to the members' own lists.
 *
 *               WHAT THE DIGEST DETECTS: how many groups you are in. Being added to one or removed
 *               from one shows up; a rename or a new message does NOT.
 *
 *               That is narrower than it looks like it should be, and the reason is worth writing
 *               down rather than hiding: a digest is only useful if BOTH sides can compute the same
 *               string, and the chat list the browser holds carries no message id — only the
 *               message's text and time. Digesting a timestamp would mean two independent
 *               renderings of the same instant having to agree forever, which is precisely the kind
 *               of quiet, occasional disagreement this mechanism exists to catch rather than cause.
 *               So the count is what both sides can honestly agree on today.
 *
 *               The consequence, stated plainly: a new message that failed to publish an event will
 *               NOT be caught here (the open conversation's own topic covers that case, and the
 *               refetch on refocus covers the rest). Adding an id to the list's last-message shape
 *               would let this digest cover ordering too — that is the fix when it matters.
 *
 *               A user may only ever read their own list. There is no cross-user case to authorize,
 *               which is why this is the one predicate that lives here rather than being asked of
 *               another module: "is this you" is not chat's question, it is identity's, and it has
 *               exactly one right answer.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.updates.map

import app.microteams.chat.message.MessagePostedEvent
import app.microteams.chat.message.MessageRepository
import app.microteams.chat.thread.ThreadMemberRepository
import app.microteams.updates.SyncedQuery
import app.microteams.updates.Topic
import app.microteams.updates.TopicState
import app.microteams.updates.UpdateKind
import app.microteams.updates.UpdatesRegistry
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import org.springframework.transaction.event.TransactionalEventListener

@Component
class ChatsQuery(
    private val registry: UpdatesRegistry,
    private val messageRepository: MessageRepository,
    private val threadMemberRepository: ThreadMemberRepository,
) : SyncedQuery<Topic.Chats> {

    private val logger = LoggerFactory.getLogger(ChatsQuery::class.java)

    override val prefix = Topic.Chats.PREFIX

    override fun parse(raw: String): Topic.Chats? =
        raw.removePrefix(prefix).toLongOrNull()?.let { Topic.Chats(it) }

    override fun mayRead(userId: Long, topic: Topic.Chats): Boolean = userId == topic.userId

    override fun digest(topic: Topic.Chats): TopicState {
        val threadIds = threadMemberRepository.findByUserId(topic.userId).mapNotNull { it.threadId }
        // The cursor still tracks the newest message across the list — that is what moves the list,
        // and it is what a client compares against to notice it missed an event. Only the digest is
        // limited to the count, for the reason in the file header.
        val newest =
            threadIds
                .mapNotNull {
                    messageRepository.findTopByThreadIdAndDeletedAtIsNullOrderByIdDesc(it)?.id
                }
                .maxOrNull() ?: 0
        return TopicState(seq = newest, digest = "${threadIds.size}")
    }

    /** One committed message moves the list of everyone in that group — including its author. */
    @TransactionalEventListener(fallbackExecution = true)
    fun onMessagePosted(event: MessagePostedEvent) {
        val id = event.messageId ?: return
        try {
            val members =
                threadMemberRepository
                    .findByThreadId(event.threadId)
                    .mapNotNull { it.userId }
                    .toSet()
            for (userId in members) {
                registry.publish(
                    topic = Topic.Chats(userId).name,
                    seq = id,
                    kind = UpdateKind.CHATS_CHANGED,
                    // A per-user topic: the only person who may hear it is its owner, and that is
                    // re-checked here rather than trusted from subscription time.
                    stillAllowed = { listener -> listener == userId },
                )
            }
        } catch (e: Exception) {
            logger.warn(
                "updates: failed publishing chat-list change for thread {}",
                event.threadId,
                e,
            )
        }
    }
}
