/*
 *  Description: Turning something chat already announces into a topic that moved.
 *
 *               This is the only kind of file that grows as features arrive, and the direction of
 *               its dependencies is the whole point: it listens to chat, chat has never heard of it.
 *               No business method calls the push layer, so the push layer cannot become something
 *               every feature has to remember to notify — which is how "notify the socket" code
 *               turns into a mutually-recursive mess in the first place.
 *
 *               It runs after commit, so the row a browser is about to fetch is really there.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.updates.map

import app.microteams.chat.message.MessagePostedEvent
import app.microteams.chat.thread.ThreadMemberRepository
import app.microteams.updates.Topic
import app.microteams.updates.UpdateKind
import app.microteams.updates.UpdatesRegistry
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import org.springframework.transaction.event.TransactionalEventListener

@Component
class ChatTopics(
    private val registry: UpdatesRegistry,
    private val threadMemberRepository: ThreadMemberRepository,
) {
    private val logger = LoggerFactory.getLogger(ChatTopics::class.java)

    @TransactionalEventListener(fallbackExecution = true)
    fun onMessagePosted(event: MessagePostedEvent) {
        val id = event.messageId ?: return // nothing to point a cursor at
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
                // Re-checked per subscriber at publish time, not trusted from subscribe time.
                stillAllowed = { userId -> userId in members },
            )
        } catch (e: Exception) {
            // A push that fails must never take the message with it: the browser still polls, and
            // the point of this protocol is that a missed event costs one refetch and nothing else.
            logger.warn("updates: failed publishing thread {} change", event.threadId, e)
        }
    }
}
