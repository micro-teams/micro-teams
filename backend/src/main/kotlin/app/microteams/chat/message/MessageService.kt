/*
 *  Description: This file implements the MessageService class — the message half of the
 *               chat module: reading a thread's messages, posting to it, and recording a
 *               message that did not reach one of its recipients. Posting also fans the
 *               message out over the STOMP broker and publishes a MessagePostedEvent, which is
 *               how an agent member of the thread is told (ChatSubscriptions, after commit).
 *
 *               listMessages(threadId, pageStart, pageSize) -> (messages, page), newest page first.
 *               postMessage(threadId, userId, body) -> the message, at most once per clientToken.
 *               markUndelivered(messageId, userId, reason) — the message definitely did not reach
 *                 [userId]; shown on the message's `undelivered`, announced with
 *                 MessageUndeliveredEvent. Idempotent per (message, recipient).
 *               MessageEntity.toDTO(undelivered) — the API shape.
 *
 *               Example: messageService.markUndelivered(41, agentUserId, "the agent was closed")
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.chat.message

import app.microteams.common.helper.PageHelper
import app.microteams.model.MessageDTO
import app.microteams.model.PageDTO
import app.microteams.model.PostMessageRequestDTO
import app.microteams.model.UndeliveredDTO
import java.time.OffsetDateTime
import java.time.ZoneOffset
import org.slf4j.LoggerFactory
import org.springframework.context.ApplicationEventPublisher
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.messaging.simp.SimpMessagingTemplate
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

@Service
@Transactional
class MessageService(
    private val messageRepository: MessageRepository,
    private val undeliveredRepository: UndeliveredRepository,
    private val messagingTemplate: SimpMessagingTemplate?,
    private val eventPublisher: ApplicationEventPublisher,
) {
    private val logger = LoggerFactory.getLogger(MessageService::class.java)

    fun listMessages(
        threadId: Long,
        pageStart: Long?,
        pageSize: Int,
    ): Pair<List<MessageDTO>, PageDTO> {
        // Chat semantics: opening a thread should land on its MOST RECENT messages, not its
        // first ones. Order newest-first and page from that (pageStart=null => the newest page),
        // then reverse the page back to ascending for display. Because the ordering is descending,
        // the page cursor (nextStart) walks toward OLDER history — so "scroll up to load older" is
        // the same call with that cursor, no extra machinery. (The previous OrderById/ascending
        // default returned the oldest page, so a thread past `pageSize` messages never showed new
        // ones — the chat-list preview did, because it reads the latest message directly.)
        val messages = messageRepository.findByThreadIdAndDeletedAtIsNullOrderByIdDesc(threadId)
        val (page, pageInfo) =
            PageHelper.pageFromAll(messages, pageStart, pageSize, { it.id!! }, null)
        val undelivered =
            undeliveredRepository.findByMessageIdIn(page.map { it.id!! }).groupBy { it.messageId!! }
        return page.map { it.toDTO(undelivered[it.id!!].orEmpty()) }.reversed() to pageInfo
    }

    /**
     * Post a message — at most once per [PostMessageRequestDTO.clientToken].
     *
     * A client that must not lose messages has to retry, and retrying a write is only safe if the
     * server can tell a retry from a new message. It cannot tell by content (sending "ok" twice on
     * purpose is ordinary) or by timing, so the client says so: the same token means the same
     * message. Posting it again returns the stored one, and notifies nobody a second time — a retry
     * must not re-ring an agent or re-appear in every viewer's socket.
     *
     * The token is optional. A caller that never retries (an agent's `say`, a script) omits it and
     * nothing changes for it.
     */
    fun postMessage(threadId: Long, userId: Long, body: PostMessageRequestDTO): MessageDTO {
        val token = body.clientToken?.takeIf { it.isNotBlank() }
        if (token != null) {
            existing(threadId, userId, token)?.let {
                return it
            }
        }
        val m =
            MessageEntity().apply {
                this.threadId = threadId
                senderId = userId
                content = body.content
                clientToken = token
            }
        try {
            messageRepository.saveAndFlush(m)
        } catch (e: DataIntegrityViolationException) {
            // Two attempts at the same message raced and this one lost. The winner's row IS the
            // answer, so read it rather than reporting a failure the caller cannot act on.
            if (token == null) throw e
            return existing(threadId, userId, token)
                ?: throw e // a violation with nothing to find is a real error, not a duplicate
        }
        val dto = m.toDTO()
        messagingTemplate?.convertAndSend("/topic/thread/$threadId", dto)
        // Wake any agent members of the thread (connector listens after commit).
        eventPublisher.publishEvent(MessagePostedEvent(threadId, userId, body.content, dto.id))
        return dto
    }

    /**
     * Record that message [messageId] definitely did not reach recipient [userId], and why. The
     * thread's readers are told through MessageUndeliveredEvent; a second report for the same
     * message and recipient changes nothing.
     */
    fun markUndelivered(messageId: Long, userId: Long, reason: String) {
        val message = messageRepository.findById(messageId).orElse(null)
        if (message == null) {
            logger.warn(
                "message {} not delivered to {} ({}), but it no longer exists",
                messageId,
                userId,
                reason,
            )
            return
        }
        if (undeliveredRepository.existsByMessageIdAndUserId(messageId, userId)) return
        undeliveredRepository.save(
            Undelivered().also {
                it.messageId = messageId
                it.userId = userId
                it.reason = reason
            },
        )
        logger.info("message {} was not delivered to user {}: {}", messageId, userId, reason)
        eventPublisher.publishEvent(MessageUndeliveredEvent(message.threadId!!, messageId, userId))
    }

    private fun existing(threadId: Long, userId: Long, token: String): MessageDTO? =
        messageRepository.findByThreadIdAndSenderIdAndClientToken(threadId, userId, token)?.let {
            it.toDTO(undeliveredRepository.findByMessageIdIn(listOf(it.id!!)))
        }
}

fun MessageEntity.toDTO(undelivered: List<Undelivered> = emptyList()) =
    MessageDTO(
        id = id!!,
        threadId = threadId!!,
        senderId = senderId!!,
        content = content ?: "",
        createdAt = createdAt?.atOffset(ZoneOffset.UTC) ?: OffsetDateTime.now(),
        editedAt = editedAt?.atOffset(ZoneOffset.UTC),
        clientToken = clientToken,
        undelivered =
            undelivered.map { UndeliveredDTO(userId = it.userId!!, reason = it.reason!!) },
    )
