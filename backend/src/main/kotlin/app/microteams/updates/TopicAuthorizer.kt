/*
 *  Description: May this user subscribe to this topic, and may they still receive it?
 *
 *               Two questions rather than one on purpose. Asking only at subscription time would
 *               leave someone who was removed from a group still hearing that group until they
 *               happened to reconnect — so the publish path asks again, per subscriber, every time.
 *
 *               It answers by asking the module that owns the concept (thread membership is chat's
 *               question) and never by deciding anything itself. This file must stay free of
 *               business rules for the same reason RolePermissionService exists: an auditor should
 *               not have to read the push layer to learn who may see what.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.updates

import app.microteams.chat.thread.ThreadMemberRepository
import org.springframework.stereotype.Component

@Component
class TopicAuthorizer(private val threadMemberRepository: ThreadMemberRepository) {

    fun mayRead(userId: Long, topic: Topic): Boolean =
        when (topic) {
            is Topic.Thread -> isMember(userId, topic.threadId)
        }

    private fun isMember(userId: Long, threadId: Long): Boolean =
        threadMemberRepository.findByThreadId(threadId).any { it.userId == userId }
}
