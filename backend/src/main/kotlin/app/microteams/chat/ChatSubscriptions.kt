/*
 *  Description: How software listens to a group, without chat having to know what that software
 *               is. A subscriber says only "I am user N, tell me what is said in groups I belong
 *               to"; chat answers the questions that are chat's to answer — who is in the thread,
 *               who wrote this, what is the speaker called — and calls back through the interface.
 *
 *               The direction matters: chat depends on nothing here. The agent module registers
 *               itself, so agents can change entirely (or a second kind of subscriber appear)
 *               without chat noticing. Before this, the orchestrator reached into
 *               ThreadMemberRepository and filtered live screens itself, which leaked group
 *               membership semantics out of chat and coupled chat's storage to the connector.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.chat

import app.microteams.chat.message.MessagePostedEvent
import app.microteams.chat.thread.ThreadMemberRepository
import app.microteams.user.UserProfileRepository
import java.util.concurrent.ConcurrentHashMap
import org.rucca.cheese.common.persistent.IdType
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import org.springframework.transaction.event.TransactionalEventListener

/** Something that wants to be told what is said in the groups it is a member of, as a user. */
interface ChatSubscriber {
    /** The user it subscribes as. It is told a message only where this user is a member. */
    val userId: IdType

    fun onMessage(threadId: IdType, senderId: IdType, speaker: String, content: String)
}

@Component
class ChatSubscriptions(
    private val threadMemberRepository: ThreadMemberRepository,
    private val userProfileRepository: UserProfileRepository,
) {
    private val logger = LoggerFactory.getLogger(ChatSubscriptions::class.java)
    private val subscribers = ConcurrentHashMap<IdType, ChatSubscriber>()

    fun register(subscriber: ChatSubscriber) {
        subscribers[subscriber.userId] = subscriber
    }

    fun unregister(userId: IdType) {
        subscribers.remove(userId)
    }

    /**
     * Fan a committed message out to the subscribers that should hear it. Runs after commit so a
     * subscriber can read the message it is being told about.
     */
    @TransactionalEventListener(fallbackExecution = true)
    fun onMessagePosted(event: MessagePostedEvent) {
        if (subscribers.isEmpty()) return
        try {
            deliver(event.threadId, event.senderId, event.content)
        } catch (e: Exception) {
            logger.warn("failed delivering message in thread {}", event.threadId, e)
        }
    }

    /** Returns how many subscribers were reached. */
    fun deliver(threadId: IdType, senderId: IdType, content: String): Int {
        val members =
            threadMemberRepository.findByThreadId(threadId).mapNotNull { it.userId }.toSet()
        val speaker = nicknameOf(senderId)
        var reached = 0
        for ((userId, subscriber) in subscribers) {
            if (userId == senderId) continue // never echo a message back to its author
            if (userId !in members) continue // only groups it belongs to
            try {
                subscriber.onMessage(threadId, senderId, speaker, content)
                reached++
            } catch (e: Exception) {
                logger.warn("subscriber {} failed handling thread {}", userId, threadId, e)
            }
        }
        return reached
    }

    private fun nicknameOf(userId: IdType): String =
        try {
            userProfileRepository
                .findByUserId(userId.toInt())
                .map { it.nickname ?: "user$userId" }
                .orElse("user$userId")
        } catch (e: Exception) {
            "user$userId"
        }
}
