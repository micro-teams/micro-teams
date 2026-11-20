/*
 *  Description: A domain event published after a chat message is committed. Chat only
 *               publishes; ChatSubscriptions (the agents subscribed to the thread) and the
 *               updates topics listen after commit.
 *
 *               MessagePostedEvent(threadId, senderId, content, messageId)
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.chat.message

/** Emitted by MessageService.postMessage once the message row is persisted. */
data class MessagePostedEvent(
    val threadId: Long,
    val senderId: Long,
    val content: String,
    val messageId: Long,
)
