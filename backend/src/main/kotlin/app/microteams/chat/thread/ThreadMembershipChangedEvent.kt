/*
 *  Description: A domain event published after who-is-in-a-thread has changed and committed.
 *
 *               A chat list is "the groups you belong to". A message moving one of them already
 *               announces itself (MessagePostedEvent), but being ADDED to a group had nothing to
 *               announce: a new thread has no messages yet, so nothing moved, so nobody was told,
 *               so the list on screen stayed as it was until something else happened to it.
 *
 *               Deliberately about membership rather than about any of the features that change
 *               it. Starting a conversation with an agent, creating a group, being invited to one,
 *               leaving one — they all end up here, and none of them has to know that a push layer
 *               exists. That direction is the point: chat announces, the updates module listens,
 *               and chat has never heard of it.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.chat.thread

/**
 * Emitted once the membership rows are persisted.
 *
 * [userIds] is everyone whose own list changed — which includes anybody REMOVED, since their list
 * lost a group and they have to hear about it too.
 */
data class ThreadMembershipChangedEvent(val threadId: Long, val userIds: Set<Long>)
