/*
 *  Description: Being added to a group changes your chat list, and you have to be told at once.
 *
 *               The list already reacted to messages — a message moves a group and the whole list
 *               reorders. What it never reacted to was JOINING one: a new thread has no messages
 *               yet, so nothing moved, so nothing was published, so the list on screen stayed as it
 *               was. "Chat with agent" was where it showed, but the hole was in membership, not in
 *               agents, and so is the fix.
 *
 *               Sent as a `state` frame on purpose: `publish` needs a cursor that only ever grows,
 *               and this topic's cursor is the newest MESSAGE id — a brand-new thread has no
 *               message to point at, so there is no honest number to advance it to.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.updates

import app.microteams.chat.message.MessageRepository
import app.microteams.chat.thread.ThreadMemberEntity
import app.microteams.chat.thread.ThreadMemberRepository
import app.microteams.chat.thread.ThreadMembershipChangedEvent
import app.microteams.updates.map.ChatsQuery
import io.mockk.every
import io.mockk.mockk
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

private class Sink(override val userId: Long) : UpdatesSink {
    val frames = mutableListOf<UpdateFrame>()

    override fun send(frame: UpdateFrame) {
        frames.add(frame)
    }
}

class ChatsMembershipTest {

    private fun member(threadId: Long, userId: Long) =
        ThreadMemberEntity().apply {
            this.threadId = threadId
            this.userId = userId
        }

    @Test
    fun `joining a group tells the people in it, with the new count`() {
        val registry = UpdatesRegistry()
        val members = mockk<ThreadMemberRepository>()
        val messages = mockk<MessageRepository>(relaxed = true)
        every { members.findByThreadId(7) } returns listOf(member(7, 1), member(7, 2))
        // Person 1 was already in one group and is now in two; person 2 is only in the new one.
        every { members.findByUserId(1) } returns listOf(member(5, 1), member(7, 1))
        every { members.findByUserId(2) } returns listOf(member(7, 2))
        every { messages.findTopByThreadIdAndDeletedAtIsNullOrderByIdDesc(any()) } returns null

        val one = Sink(1)
        val two = Sink(2)
        registry.subscribe("chats:1", one, since = null)
        registry.subscribe("chats:2", two, since = null)

        ChatsQuery(registry, messages, members)
            .onMembershipChanged(ThreadMembershipChangedEvent(7, setOf(1, 2)))

        val toOne = one.frames.single { it.t == "state" }
        assertEquals("chats:1", toOne.topic)
        assertEquals("2", toOne.digest, "person 1 is in two groups now")
        val toTwo = two.frames.single { it.t == "state" }
        assertEquals("1", toTwo.digest)
    }

    @Test
    fun `a repository that fails does not take the change with it`() {
        // A push that cannot be made is one refetch late, which the periodic verifier will cover.
        // Throwing here would fail the transaction that added somebody to a group.
        val registry = UpdatesRegistry()
        val members = mockk<ThreadMemberRepository>()
        val messages = mockk<MessageRepository>(relaxed = true)
        every { members.findByUserId(any()) } throws IllegalStateException("the database went away")

        ChatsQuery(registry, messages, members)
            .onMembershipChanged(ThreadMembershipChangedEvent(7, setOf(1)))

        assertTrue(true, "returned rather than threw")
    }
}
