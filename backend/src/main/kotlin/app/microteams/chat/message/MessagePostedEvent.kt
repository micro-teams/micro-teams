/*
 *  Description: A domain event published after a chat message is committed. It decouples
 *               the chat module from the connector: ThreadService only publishes; the
 *               connector's AgentService listens (after commit) and forwards the message
 *               to any agent members of the thread. Keeping this an event avoids a
 *               chat <-> connector bean cycle.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.chat.message

/** Emitted by ThreadService.postMessage once the message row is persisted. */
data class MessagePostedEvent(val threadId: Long, val senderId: Long, val content: String)
