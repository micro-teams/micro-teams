/*
 *  Description: This file implements the ThreadService class — the thread half of the
 *               chat module: the chat list, the thread itself and its membership.
 *               Messages belong to MessageService (chat/message); this service only reads
 *               a thread's last message to build the chat list.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.chat.thread

import app.microteams.chat.message.MessageRepository
import app.microteams.common.helper.PageHelper
import app.microteams.model.*
import app.microteams.user.UserProfile
import app.microteams.user.UserProfileRepository
import app.microteams.user.UserRepository
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset
import org.rucca.cheese.common.error.BadRequestError
import org.rucca.cheese.common.error.NotFoundError
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

@Service
@Transactional
class ThreadService(
    private val threadRepository: ThreadRepository,
    private val threadMemberRepository: ThreadMemberRepository,
    private val messageRepository: MessageRepository,
    private val userProfileRepository: UserProfileRepository,
    private val userRepository: UserRepository,
) {
    /**
     * Reject any id that does not refer to an existing user before it can be added as a thread
     * member — otherwise a bogus id (e.g. 1000) silently creates a phantom member rendered as
     * "user1000". Users live in the shared read-only `public.user` table (id is an Int).
     */
    private fun requireUsersExist(userIds: Collection<Long>) {
        val unknown = userIds.distinct().filterNot { userRepository.existsById(it.toInt()) }
        if (unknown.isNotEmpty())
            throw BadRequestError("no such user(s): ${unknown.joinToString(", ")}")
    }

    /**
     * The caller's chats, each with its members and its last message, most-recent activity first —
     * everything the chat list renders (last line + member avatars) in one call.
     */
    fun listChats(
        userId: Long,
        pageStart: Long?,
        pageSize: Int,
    ): Pair<List<ChatSummaryDTO>, PageDTO> {
        val summaries =
            threadRepository
                .threadsForUser(userId)
                .map { it.toChatSummaryDTO() }
                .sortedWith(
                    compareByDescending<ChatSummaryDTO> { it.updatedAt }.thenByDescending { it.id }
                )
        val (page, pageInfo) =
            PageHelper.pageFromAll(summaries, pageStart, pageSize, { it.id }, null)
        return page to pageInfo
    }

    private fun ThreadEntity.toChatSummaryDTO(): ChatSummaryDTO {
        val threadId = id!!
        val members =
            threadMemberRepository
                .findByThreadId(threadId)
                .mapNotNull { it.userId }
                .map { uid ->
                    val profile = userProfileRepository.findByUserId(uid.toInt()).orElse(null)
                    ChatMemberDTO(
                        userId = uid,
                        nickname = profile?.nickname ?: "user$uid",
                        avatarId = profile?.avatar?.id,
                    )
                }
        val last = messageRepository.findTopByThreadIdAndDeletedAtIsNullOrderByIdDesc(threadId)
        val activity = last?.createdAt ?: createdAt ?: LocalDateTime.MIN
        return ChatSummaryDTO(
            id = threadId,
            title = title ?: "",
            members = members,
            lastMessage =
                last?.let {
                    ChatLastMessageDTO(
                        content = it.content ?: "",
                        senderId = it.senderId!!,
                        createdAt = it.createdAt!!.atOffset(ZoneOffset.UTC),
                    )
                },
            updatedAt = activity.atOffset(ZoneOffset.UTC),
        )
    }

    fun createThread(userId: Long, body: CreateThreadRequestDTO): ThreadDTO {
        body.memberIds?.let { requireUsersExist(it.filter { mid -> mid != userId }) }
        val t = ThreadEntity().apply { title = body.title }
        threadRepository.save(t)
        threadMemberRepository.save(
            ThreadMemberEntity().apply {
                threadId = t.id
                this.userId = userId
                role = ThreadMemberRole.OWNER
            }
        )
        body.memberIds?.forEach { mid ->
            if (mid != userId)
                threadMemberRepository.save(
                    ThreadMemberEntity().apply {
                        threadId = t.id
                        this.userId = mid
                        role = ThreadMemberRole.MEMBER
                    }
                )
        }
        return t.toDTO()
    }

    fun getThread(threadId: Long): ThreadDetailDTO {
        val t =
            threadRepository.findById(threadId).orElseThrow { NotFoundError("thread", threadId) }
        return ThreadDetailDTO(thread = t.toDTO(), members = listMembers(threadId))
    }

    fun renameThread(threadId: Long, body: RenameThreadRequestDTO): ThreadDTO {
        val t =
            threadRepository.findById(threadId).orElseThrow { NotFoundError("thread", threadId) }
        t.title = body.title
        threadRepository.save(t)
        return t.toDTO()
    }

    fun dissolveThread(threadId: Long) {
        val t =
            threadRepository.findById(threadId).orElseThrow { NotFoundError("thread", threadId) }
        t.deletedAt = LocalDateTime.now()
        threadRepository.save(t)
    }

    fun listMembers(threadId: Long): List<ThreadMemberDTO> =
        threadMemberRepository.findByThreadId(threadId).map { it.toDTO(profileOf(it.userId!!)) }

    private fun profileOf(userId: Long): UserProfile? =
        userProfileRepository.findByUserId(userId.toInt()).orElse(null)

    fun addMember(threadId: Long, userId: Long, role: ThreadMemberRole) {
        requireUsersExist(listOf(userId))
        val existing = threadMemberRepository.findByThreadIdAndUserId(threadId, userId)
        if (existing != null) {
            existing.role = role
            threadMemberRepository.save(existing)
        } else {
            threadMemberRepository.save(
                ThreadMemberEntity().apply {
                    this.threadId = threadId
                    this.userId = userId
                    this.role = role
                }
            )
        }
    }

    fun removeMember(threadId: Long, userId: Long) {
        threadMemberRepository.deleteByThreadIdAndUserId(threadId, userId)
    }

    fun changeMemberRole(threadId: Long, userId: Long, role: ThreadMemberRole) {
        val m =
            threadMemberRepository.findByThreadIdAndUserId(threadId, userId)
                ?: throw NotFoundError("member", userId)
        m.role = role
        threadMemberRepository.save(m)
    }
}

fun ThreadEntity.toDTO() =
    ThreadDTO(
        id = id!!,
        title = title,
        createdAt = createdAt?.atOffset(ZoneOffset.UTC) ?: OffsetDateTime.now(),
        updatedAt = updatedAt?.atOffset(ZoneOffset.UTC),
    )

/**
 * [profile] is the member's, looked up by the caller: the DTO carries the nickname and avatar so a
 * thread view can paint its members without a second round-trip per user.
 */
fun ThreadMemberEntity.toDTO(profile: UserProfile?) =
    ThreadMemberDTO(
        id = id!!,
        threadId = threadId!!,
        userId = userId!!,
        role = role.toDTO(),
        joinedAt = createdAt?.atOffset(ZoneOffset.UTC) ?: OffsetDateTime.now(),
        nickname = profile?.nickname ?: "user${userId!!}",
        avatarId = profile?.avatar?.id?.toLong(),
    )
