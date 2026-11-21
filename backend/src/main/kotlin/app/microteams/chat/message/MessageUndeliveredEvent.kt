/*
 *  Description: A domain event published after a message was recorded as not delivered to one of
 *               its recipients (see Undelivered), so whoever shows the thread can refetch it.
 *
 *               MessageUndeliveredEvent(threadId, messageId, userId)
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.chat.message

data class MessageUndeliveredEvent(val threadId: Long, val messageId: Long, val userId: Long)
