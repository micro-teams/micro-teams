/*
 *  Description: The chat module's one controller — every method implements a ChatApi
 *               operation generated from MicroTeams-API.yml, nothing more. It serves the whole
 *               /chat surface: the chat list, the thread and its membership (delegated to
 *               thread/ThreadService) and the messages (delegated to
 *               message/MessageService), and registers the chat authorization logics
 *               (owner resolver, member/admin/author predicates).
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.chat

import app.microteams.api.ChatApi
import app.microteams.chat.message.MessageRepository
import app.microteams.chat.message.MessageService
import app.microteams.chat.thread.*
import app.microteams.model.*
import javax.annotation.PostConstruct
import org.rucca.cheese.auth.AuthenticationService
import org.rucca.cheese.auth.AuthorizationService
import org.rucca.cheese.auth.AuthorizedAction
import org.rucca.cheese.auth.annotation.AuthInfo
import org.rucca.cheese.auth.annotation.Guard
import org.rucca.cheese.auth.annotation.ResourceId
import org.rucca.cheese.common.persistent.IdGetter
import org.rucca.cheese.common.persistent.IdType
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*

@RestController
class ChatController(
    private val threadService: ThreadService,
    private val messageService: MessageService,
    private val authorizationService: AuthorizationService,
    private val authenticationService: AuthenticationService,
    private val threadMemberRepository: ThreadMemberRepository,
    private val messageRepository: MessageRepository,
) : ChatApi {
    @PostConstruct
    fun initialize() {
        // Register the thread-ownership resolver so the built-in "owned" custom logic
        // (AuthorizationService.kt:45) can answer "does user X own resource thread Y?"
        // without an is-thread-owner handler. Must match the resourceType used by @Guard /
        // RolePermissionService ("chat_thread"); otherwise "owned" can't resolve an owner.
        authorizationService.ownerIds.register("chat_thread") { threadId ->
            threadMemberRepository.findByThreadIdAndRole(threadId, ThreadMemberRole.OWNER)?.userId
                ?: 0
        }

        // is-thread-member: user is any member (member/admin/owner) of a thread. Every
        // @Guard that uses this passes the THREAD id as the resource id (postMessage /
        // listMessages / getThread all bind @ResourceId to the thread path param), so the
        // resource id is the thread id directly — never a message id (that is
        // is-message-author's job). We must NOT reinterpret it as a message id: message and
        // thread ids come from independent sequences and collide, so a thread id that also
        // exists as a message id would resolve to the wrong thread and wrongly 403 a member.
        authorizationService.customAuthLogics.register("is-thread-member") {
            userId: IdType,
            _: AuthorizedAction,
            _: String,
            resourceId: IdType?,
            _: Map<String, Any>,
            _: IdGetter?,
            _: Any? ->
            resourceId != null &&
                threadMemberRepository.findByThreadIdAndUserId(resourceId, userId) != null
        }

        // is-thread-admin: user is admin or owner of a thread (role >= 1). Resource id is the
        // thread id directly (see is-thread-member above for why we don't remap it).
        authorizationService.customAuthLogics.register("is-thread-admin") {
            userId: IdType,
            _: AuthorizedAction,
            _: String,
            resourceId: IdType?,
            _: Map<String, Any>,
            _: IdGetter?,
            _: Any? ->
            if (resourceId == null) false
            else {
                val m = threadMemberRepository.findByThreadIdAndUserId(resourceId, userId)
                m != null && (m.role == ThreadMemberRole.ADMIN || m.role == ThreadMemberRole.OWNER)
            }
        }

        // is_message_author: user wrote the message (resourceId = message id).
        authorizationService.customAuthLogics.register("is-message-author") {
            userId: IdType,
            _: AuthorizedAction,
            _: String,
            resourceId: IdType?,
            _: Map<String, Any>,
            _: IdGetter?,
            _: Any? ->
            resourceId != null &&
                messageRepository.findById(resourceId).orElse(null)?.senderId == userId
        }
    }

    @Guard("enumerate-my-chats", "chat_thread")
    override fun listChats(pageStart: Long?, pageSize: Int): ResponseEntity<ListChatsResponseDTO> {
        val userId = authenticationService.getCurrentUserId()
        val (chats, page) = threadService.listChats(userId, pageStart, pageSize)
        return ResponseEntity.ok(ListChatsResponseDTO(chats = chats, page = page))
    }

    @Guard("create-chat", "chat_thread")
    override fun createThread(
        @AuthInfo("createThread") createThreadRequestDTO: CreateThreadRequestDTO?
    ): ResponseEntity<ThreadDTO> {
        val body = createThreadRequestDTO ?: return ResponseEntity.badRequest().build()
        val userId = authenticationService.getCurrentUserId()
        return ResponseEntity(threadService.createThread(userId, body), HttpStatus.CREATED)
    }

    @Guard("query-chat", "chat_thread")
    override fun getThread(
        @PathVariable("id") @ResourceId id: Long
    ): ResponseEntity<ThreadDetailDTO> = ResponseEntity.ok(threadService.getThread(id))

    @Guard("rename-chat", "chat_thread")
    override fun renameThread(
        @PathVariable("id") @ResourceId id: Long,
        dto: RenameThreadRequestDTO?,
    ): ResponseEntity<ThreadDTO> = ResponseEntity.ok(threadService.renameThread(id, dto!!))

    @Guard("dissolve-chat", "chat_thread")
    override fun dissolveThread(@PathVariable("id") @ResourceId id: Long): ResponseEntity<Unit> {
        threadService.dissolveThread(id)
        return ResponseEntity(HttpStatus.NO_CONTENT)
    }

    @Guard("enumerate-messages", "chat_message")
    override fun listMessages(
        @PathVariable("id") @ResourceId id: Long,
        pageStart: Long?,
        pageSize: Int,
    ): ResponseEntity<ListMessagesResponseDTO> {
        val (messages, page) = messageService.listMessages(id, pageStart, pageSize)
        return ResponseEntity.ok(ListMessagesResponseDTO(messages = messages, page = page))
    }

    @Guard("post-message", "chat_message")
    override fun postMessage(
        @PathVariable("id") @ResourceId id: Long,
        dto: PostMessageRequestDTO?,
    ): ResponseEntity<MessageDTO> {
        val userId = authenticationService.getCurrentUserId()
        return ResponseEntity(messageService.postMessage(id, userId, dto!!), HttpStatus.CREATED)
    }

    @Guard("enumerate-chat-members", "chat_thread")
    override fun listThreadMembers(
        @PathVariable("id") @ResourceId id: Long
    ): ResponseEntity<List<ThreadMemberDTO>> = ResponseEntity.ok(threadService.listMembers(id))

    @Guard("add-chat-member", "chat_thread")
    override fun addThreadMember(
        @PathVariable("id") @ResourceId id: Long,
        @AuthInfo("addMember") dto: AddMemberRequestDTO?,
    ): ResponseEntity<Unit> {
        val body = dto ?: return ResponseEntity.badRequest().build()
        threadService.addMember(id, body.userId, body.role?.toDomain() ?: ThreadMemberRole.MEMBER)
        return ResponseEntity(HttpStatus.NO_CONTENT)
    }

    @Guard("remove-chat-member", "chat_thread")
    override fun removeThreadMember(
        @PathVariable("id") @ResourceId id: Long,
        @PathVariable("userId") userId: Long,
    ): ResponseEntity<Unit> {
        threadService.removeMember(id, userId)
        return ResponseEntity(HttpStatus.NO_CONTENT)
    }

    @Guard("change-chat-member-role", "chat_thread")
    override fun changeThreadMemberRole(
        @PathVariable("id") @ResourceId id: Long,
        @PathVariable("userId") userId: Long,
        dto: ChangeRoleRequestDTO?,
    ): ResponseEntity<Unit> {
        threadService.changeMemberRole(id, userId, dto!!.role.toDomain())
        return ResponseEntity(HttpStatus.NO_CONTENT)
    }
}
