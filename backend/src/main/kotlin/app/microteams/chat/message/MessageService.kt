/*
 *  Description: This file implements the MessageService class — the message half of the
 *               chat module: reading a thread's messages and posting to it. Posting also
 *               fans the message out over the STOMP broker and publishes a
 *               MessagePostedEvent, which is how an agent member of the thread is woken
 *               (the connector listens for it after commit).
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
import java.time.OffsetDateTime
import java.time.ZoneOffset
import org.springframework.context.ApplicationEventPublisher
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.messaging.simp.SimpMessagingTemplate
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

@Service
@Transactional
class MessageService(
    private val messageRepository: MessageRepository,
    private val messagingTemplate: SimpMessagingTemplate?,
    private val eventPublisher: ApplicationEventPublisher,
) {
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
        return page.map { it.toDTO() }.reversed() to pageInfo
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

    private fun existing(threadId: Long, userId: Long, token: String): MessageDTO? =
        messageRepository.findByThreadIdAndSenderIdAndClientToken(threadId, userId, token)?.toDTO()
}

fun MessageEntity.toDTO() =
    MessageDTO(
        id = id!!,
        threadId = threadId!!,
        senderId = senderId!!,
        content = content ?: "",
        createdAt = createdAt?.atOffset(ZoneOffset.UTC) ?: OffsetDateTime.now(),
        editedAt = editedAt?.atOffset(ZoneOffset.UTC),
        clientToken = clientToken,
    )
