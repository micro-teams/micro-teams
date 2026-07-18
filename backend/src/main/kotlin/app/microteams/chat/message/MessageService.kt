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
        val messages = messageRepository.findByThreadIdAndDeletedAtIsNullOrderById(threadId)
        val (page, pageInfo) =
            PageHelper.pageFromAll(messages, pageStart, pageSize, { it.id!! }, null)
        return page.map { it.toDTO() } to pageInfo
    }

    fun postMessage(threadId: Long, userId: Long, body: PostMessageRequestDTO): MessageDTO {
        val m =
            MessageEntity().apply {
                this.threadId = threadId
                senderId = userId
                content = body.content
            }
        messageRepository.save(m)
        val dto = m.toDTO()
        messagingTemplate?.convertAndSend("/topic/thread/$threadId", dto)
        // Wake any agent members of the thread (connector listens after commit).
        eventPublisher.publishEvent(MessagePostedEvent(threadId, userId, body.content))
        return dto
    }
}

fun MessageEntity.toDTO() =
    MessageDTO(
        id = id!!,
        threadId = threadId!!,
        senderId = senderId!!,
        content = content ?: "",
        createdAt = createdAt?.atOffset(ZoneOffset.UTC) ?: OffsetDateTime.now(),
        editedAt = editedAt?.atOffset(ZoneOffset.UTC),
    )
