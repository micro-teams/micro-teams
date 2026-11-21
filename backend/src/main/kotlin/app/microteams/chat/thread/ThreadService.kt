/*
 *  Description: This file implements the ThreadService class — the thread half of the
 *               chat module: the chat list, the thread itself and its membership.
 *               Messages belong to MessageService (chat/message); this service reads a
 *               thread's last message to build the chat list, and writes the JOINED and LEFT
 *               lines that record membership changes in the thread itself.
 *
 *               Members have no roles: every member may speak, rename, add, remove and delete.
 *               Who may read a thread without being a member is the team module's business
 *               (a thread in a team is readable by whoever can access the team); it answers
 *               which teams a thread is in through ThreadTeams.
 *
 *               listChats(userId, …) — the caller's chats; summaries(threadIds, userId, …) — any.
 *               createThread(userId, body) / getThread(threadId, callerId) / renameThread /
 *               dissolveThread
 *               listMembers(threadId) / isMember(threadId, userId)
 *               addMember(threadId, userId) / removeMember(threadId, userId) — each writes a line.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.chat.thread

import app.microteams.chat.message.MessageEntity
import app.microteams.chat.message.MessageKind
import app.microteams.chat.message.MessageRepository
import app.microteams.common.helper.PageHelper
import app.microteams.model.*
import app.microteams.user.AgentUsers
import app.microteams.user.UserProfile
import app.microteams.user.UserProfileRepository
import app.microteams.user.UserRepository
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset
import org.rucca.cheese.common.error.BadRequestError
import org.rucca.cheese.common.error.NotFoundError
import org.springframework.beans.factory.ObjectProvider
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
    // Optional: "which of these users are agents" is answered by whoever knows what an agent is
    // (the agent module implements AgentUsers). Chat only ever asks, and only when a caller asked
    // it to — a deployment with no such module simply answers nobody.
    private val agentUsers: ObjectProvider<AgentUsers>,
    private val threadTeams: ObjectProvider<ThreadTeams>,
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
        // Whether to also report which members are agents. Off unless the caller asked: answering
        // costs one extra query, and only the chat list needs it (see AgentUsers).
        queryIsMemberAgent: Boolean = false,
    ): Pair<List<ChatSummaryDTO>, PageDTO> {
        val summaries =
            threadRepository
                .threadsForUser(userId)
                .map { it.toChatSummaryDTO(userId) }
                .sortedWith(
                    compareByDescending<ChatSummaryDTO> { it.updatedAt }.thenByDescending { it.id },
                )
        val (page, pageInfo) =
            PageHelper.pageFromAll(summaries, pageStart, pageSize, { it.id }, null)
        return withAgentFlags(page, queryIsMemberAgent) to pageInfo
    }

    /**
     * Mark which members of these chats are agents, asked once for the whole page rather than per
     * member. Applied AFTER paging, so a request only pays for the chats it is actually returning.
     *
     * Untouched when the caller did not ask: `isAgent` then stays null, and a client can tell that
     * apart from "asked, and this member is not an agent" — which matters, because the chat list
     * only skips its own agent lookup when it knows the answer really came from the server.
     */
    private fun withAgentFlags(
        chats: List<ChatSummaryDTO>,
        queryIsMemberAgent: Boolean,
    ): List<ChatSummaryDTO> {
        if (!queryIsMemberAgent || chats.isEmpty()) return chats
        val memberIds = chats.flatMap { chat -> chat.members.map { it.userId } }
        val agents =
            agentUsers.getIfAvailable()?.agentsAmong(memberIds)
                ?: emptySet<org.rucca.cheese.common.persistent.IdType>()
        return chats.map { chat ->
            chat.copy(members = chat.members.map { it.copy(isAgent = it.userId in agents) })
        }
    }

    /** Chat summaries of the given threads (those that exist), most-recent activity first. */
    fun summaries(
        threadIds: Collection<Long>,
        userId: Long,
        queryIsMemberAgent: Boolean,
    ): List<ChatSummaryDTO> =
        withAgentFlags(
            threadRepository
                .findAllById(threadIds.toSet())
                .map { it.toChatSummaryDTO(userId) }
                .sortedWith(
                    compareByDescending<ChatSummaryDTO> { it.updatedAt }.thenByDescending { it.id },
                ),
            queryIsMemberAgent,
        )

    private fun ThreadEntity.toChatSummaryDTO(caller: Long): ChatSummaryDTO {
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
        val last =
            messageRepository.findTopByThreadIdAndKindAndDeletedAtIsNullOrderByIdDesc(
                threadId,
                MessageKind.TEXT,
            )
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
            isMember = members.any { it.userId == caller },
        )
    }

    fun createThread(userId: Long, body: CreateThreadRequestDTO): ThreadDTO {
        body.memberIds?.let { requireUsersExist(it.filter { mid -> mid != userId }) }
        val t = ThreadEntity().apply { title = body.title }
        threadRepository.save(t)
        (listOf(userId) + body.memberIds.orEmpty()).distinct().forEach { mid ->
            threadMemberRepository.save(
                ThreadMemberEntity().apply {
                    threadId = t.id
                    this.userId = mid
                },
            )
        }
        return t.toDTO()
    }

    fun getThread(threadId: Long, callerId: Long): ThreadDetailDTO {
        val t =
            threadRepository.findById(threadId).orElseThrow { NotFoundError("thread", threadId) }
        return ThreadDetailDTO(
            thread = t.toDTO(),
            members = listMembers(threadId),
            teams = threadTeams.ifAvailable?.teamsOf(threadId) ?: emptyList(),
            isMember = isMember(threadId, callerId),
        )
    }

    fun isMember(threadId: Long, userId: Long): Boolean =
        threadMemberRepository.findByThreadIdAndUserId(threadId, userId) != null

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

    /** Make [userId] a member, recorded in the thread as a JOINED line; nothing if already one. */
    fun addMember(threadId: Long, userId: Long) {
        requireUsersExist(listOf(userId))
        if (isMember(threadId, userId)) return
        threadMemberRepository.save(
            ThreadMemberEntity().apply {
                this.threadId = threadId
                this.userId = userId
            },
        )
        line(threadId, userId, MessageKind.JOINED)
    }

    /** End [userId]'s membership, recorded in the thread as a LEFT line; nothing if not one. */
    fun removeMember(threadId: Long, userId: Long) {
        if (!isMember(threadId, userId)) return
        threadMemberRepository.deleteByThreadIdAndUserId(threadId, userId)
        line(threadId, userId, MessageKind.LEFT)
    }

    private fun line(threadId: Long, userId: Long, kind: MessageKind) {
        messageRepository.save(
            MessageEntity().apply {
                this.threadId = threadId
                this.senderId = userId
                this.kind = kind
                this.content = ""
            },
        )
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
        joinedAt = createdAt?.atOffset(ZoneOffset.UTC) ?: OffsetDateTime.now(),
        nickname = profile?.nickname ?: "user${userId!!}",
        avatarId = profile?.avatar?.id?.toLong(),
    )
