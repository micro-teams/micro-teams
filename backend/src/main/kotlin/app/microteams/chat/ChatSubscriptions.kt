/*
 *  Description: How software listens to a group, without chat having to know what that software
 *               is. A subscriber says only "I am user N, tell me what is said in groups I belong
 *               to"; chat answers the questions that are chat's to answer — who is in the thread,
 *               who wrote this, what is the speaker called — and calls back through the interface.
 *
 *               Nobody tells this class a message was posted. It registers with Hibernate to hear
 *               every message row inserted, once its transaction has committed, and hands each new
 *               TEXT message to its thread's subscribers on one thread, in commit order. So a
 *               message posted by any code path reaches them and no business code announces it.
 *               (Hearing inserts is in-process and exact; following the table from an id cursor is
 *               not, since ids are handed out before commit and transactions commit out of order.)
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

import app.microteams.chat.message.MessageEntity
import app.microteams.chat.message.MessageKind
import app.microteams.chat.message.MessageRepository
import app.microteams.chat.thread.ThreadMemberRepository
import app.microteams.user.UserProfileRepository
import jakarta.annotation.PreDestroy
import jakarta.persistence.EntityManagerFactory
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import org.hibernate.engine.spi.SessionFactoryImplementor
import org.hibernate.event.service.spi.EventListenerRegistry
import org.hibernate.event.spi.EventType
import org.hibernate.event.spi.PostCommitInsertEventListener
import org.hibernate.event.spi.PostInsertEvent
import org.hibernate.persister.entity.EntityPersister
import org.rucca.cheese.common.persistent.IdType
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component

/** Something that wants to be told what is said in the groups it is a member of, as a user. */
interface ChatSubscriber {
    /** The user it subscribes as. It is told a message only where this user is a member. */
    val userId: IdType

    /**
     * [messageId] names the message, so a subscriber that learns it could not take it can say so
     * with MessageService.markUndelivered.
     */
    fun onMessage(
        threadId: IdType,
        messageId: IdType,
        senderId: IdType,
        speaker: String,
        content: String,
    )
}

@Component
class ChatSubscriptions(
    private val threadMemberRepository: ThreadMemberRepository,
    private val userProfileRepository: UserProfileRepository,
    private val messageRepository: MessageRepository,
    entityManagerFactory: EntityManagerFactory,
) {
    private val logger = LoggerFactory.getLogger(ChatSubscriptions::class.java)
    private val subscribers = ConcurrentHashMap<IdType, ChatSubscriber>()
    private val delivery = Executors.newSingleThreadExecutor { r ->
        Thread(r, "chat-delivery").apply { isDaemon = true }
    }

    init {
        val registry =
            entityManagerFactory
                .unwrap(SessionFactoryImplementor::class.java)
                .serviceRegistry
                .getService(EventListenerRegistry::class.java)!!
        registry.appendListeners(
            EventType.POST_COMMIT_INSERT,
            object : PostCommitInsertEventListener {
                override fun onPostInsert(event: PostInsertEvent) {
                    val m = event.entity as? MessageEntity ?: return
                    if (m.kind != MessageKind.TEXT) return
                    val thread = m.threadId!!
                    val id = m.id!!
                    val sender = m.senderId!!
                    val content = m.content ?: ""
                    delivery.execute { safely(thread, id, sender, content) }
                }

                override fun onPostInsertCommitFailed(event: PostInsertEvent) {}

                override fun requiresPostCommitHandling(persister: EntityPersister): Boolean =
                    persister.mappedClass == MessageEntity::class.java
            },
        )
    }

    @PreDestroy
    fun stop() {
        delivery.shutdownNow()
    }

    private fun safely(threadId: IdType, messageId: IdType, senderId: IdType, content: String) {
        if (subscribers.isEmpty()) return
        try {
            deliver(threadId, messageId, senderId, content)
        } catch (e: Exception) {
            logger.warn("failed delivering message {} in thread {}", messageId, threadId, e)
        }
    }

    fun register(subscriber: ChatSubscriber) {
        subscribers[subscriber.userId] = subscriber
    }

    fun unregister(userId: IdType) {
        subscribers.remove(userId)
    }

    /** Returns how many subscribers were reached. */
    fun deliver(threadId: IdType, messageId: IdType, senderId: IdType, content: String): Int {
        val members =
            threadMemberRepository.findByThreadId(threadId).mapNotNull { it.userId }.toSet()
        val speaker = nicknameOf(senderId)
        val told = withMembershipLines(threadId, messageId, content)
        var reached = 0
        for ((userId, subscriber) in subscribers) {
            if (userId == senderId) continue // never echo a message back to its author
            if (userId !in members) continue // only groups it belongs to
            try {
                subscriber.onMessage(threadId, messageId, senderId, speaker, told)
                reached++
            } catch (e: Exception) {
                logger.warn("subscriber {} failed handling thread {}", userId, threadId, e)
            }
        }
        return reached
    }

    /**
     * [content], preceded by the membership changes since the thread's previous message: an agent
     * learns who joined and left together with the next thing said, so a change of membership never
     * wakes it on its own.
     */
    private fun withMembershipLines(threadId: IdType, messageId: IdType, content: String): String {
        val previous =
            messageRepository
                .findTopByThreadIdAndKindAndIdLessThanOrderByIdDesc(
                    threadId,
                    MessageKind.TEXT,
                    messageId,
                )
                ?.id ?: 0
        val lines =
            messageRepository.findByThreadIdAndKindInAndIdGreaterThanAndIdLessThanOrderById(
                threadId,
                listOf(MessageKind.JOINED, MessageKind.LEFT),
                previous,
                messageId,
            )
        if (lines.isEmpty()) return content
        val said =
            lines.joinToString("\n") {
                "(${nicknameOf(it.senderId!!)} ${if (it.kind == MessageKind.JOINED) "joined" else "left"} this chat)"
            }
        return "$said\n$content"
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
