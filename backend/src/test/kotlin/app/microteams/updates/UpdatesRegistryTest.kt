/*
 *  Description: Unit tests for UpdatesRegistry — subscriptions, cursors, reconnect catch-up, the
 *               gap, and the rule that permission is re-checked at publish time. No Spring, no
 *               socket: the registry is I/O-free precisely so these cases can be written directly,
 *               including the ones a real client could only produce by unplugging a cable.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.updates

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

private class FakeSink(override val userId: Long) : UpdatesSink {
    val frames = mutableListOf<UpdateFrame>()

    override fun send(frame: UpdateFrame) {
        frames.add(frame)
    }

    fun kinds() = frames.map { it.t }

    fun seqs() = frames.filter { it.t == "event" }.mapNotNull { it.seq }
}

class UpdatesRegistryTest {

    @Test
    fun `a subscriber hears what happens after it subscribes`() {
        val registry = UpdatesRegistry()
        val sink = FakeSink(1)
        registry.subscribe("thread:7", sink, since = null)

        registry.publish("thread:7", 100, UpdateKind.MESSAGE_CREATED)

        assertEquals(listOf(100L), sink.seqs())
        assertEquals(100L, registry.cursorOf("thread:7"))
    }

    @Test
    fun `an unsubscribed topic is not delivered`() {
        val registry = UpdatesRegistry()
        val sink = FakeSink(1)
        registry.subscribe("thread:7", sink, since = null)
        registry.unsubscribe("thread:7", sink)

        registry.publish("thread:7", 100, UpdateKind.MESSAGE_CREATED)

        assertTrue(sink.frames.isEmpty())
        // The topic still moved, even with nobody listening — a later subscriber must see that.
        assertEquals(100L, registry.cursorOf("thread:7"))
    }

    /**
     * The reconnect that can be caught up: everything it missed is still in the ring, so it is
     * replayed event by event and no refetch of the whole topic is needed.
     */
    @Test
    fun `a reconnect within the ring is replayed`() {
        val registry = UpdatesRegistry()
        val early = FakeSink(1)
        registry.subscribe("thread:7", early, since = null)
        registry.publish("thread:7", 100, UpdateKind.MESSAGE_CREATED)
        registry.publish("thread:7", 101, UpdateKind.MESSAGE_CREATED)
        registry.publish("thread:7", 102, UpdateKind.MESSAGE_CREATED)

        val back = FakeSink(1)
        val cursor = registry.subscribe("thread:7", back, since = 100)

        assertEquals(listOf(101L, 102L), back.seqs())
        assertEquals(102L, cursor)
    }

    /**
     * The reconnect that cannot: the ring no longer reaches back that far, so we say `gap` once
     * rather than replay a partial history that would silently lose a message.
     */
    @Test
    fun `a reconnect older than the ring gets one gap`() {
        val registry = UpdatesRegistry(ringSize = 4)
        val sink = FakeSink(1)
        registry.subscribe("thread:7", sink, since = null)
        (1L..10L).forEach { registry.publish("thread:7", it, UpdateKind.MESSAGE_CREATED) }

        val back = FakeSink(1)
        registry.subscribe("thread:7", back, since = 2)

        assertEquals(listOf("gap"), back.kinds())
        assertEquals(10L, back.frames.single().seq)
    }

    @Test
    fun `a reconnect that missed nothing is told nothing`() {
        val registry = UpdatesRegistry()
        val sink = FakeSink(1)
        registry.subscribe("thread:7", sink, since = null)
        registry.publish("thread:7", 100, UpdateKind.MESSAGE_CREATED)

        val back = FakeSink(1)
        registry.subscribe("thread:7", back, since = 100)

        assertTrue(back.frames.isEmpty())
    }

    /** A first-ever subscriber to a topic that already moved has no history to catch up on. */
    @Test
    fun `subscribing without a since replays nothing`() {
        val registry = UpdatesRegistry()
        val first = FakeSink(1)
        registry.subscribe("thread:7", first, since = null)
        registry.publish("thread:7", 100, UpdateKind.MESSAGE_CREATED)

        val fresh = FakeSink(2)
        val cursor = registry.subscribe("thread:7", fresh, since = null)

        assertTrue(fresh.frames.isEmpty())
        assertEquals(100L, cursor)
    }

    /**
     * Being allowed at subscribe time is not the same statement as being allowed now. Someone
     * removed from a group must stop hearing it on the very next event, not on their next
     * reconnect.
     */
    @Test
    fun `a subscriber who lost access stops hearing the topic at once`() {
        val registry = UpdatesRegistry()
        val stays = FakeSink(1)
        val removed = FakeSink(2)
        registry.subscribe("thread:7", stays, since = null)
        registry.subscribe("thread:7", removed, since = null)

        registry.publish("thread:7", 100, UpdateKind.MESSAGE_CREATED) { it != 2L }
        registry.publish("thread:7", 101, UpdateKind.MESSAGE_CREATED) { it != 2L }

        assertEquals(listOf(100L, 101L), stays.seqs())
        assertTrue(removed.frames.isEmpty())
        assertEquals(1, registry.subscriberCount("thread:7"))
    }

    @Test
    fun `forgetting a connection removes it from every topic`() {
        val registry = UpdatesRegistry()
        val sink = FakeSink(1)
        registry.subscribe("thread:7", sink, since = null)
        registry.subscribe("thread:8", sink, since = null)

        registry.forget(sink)

        assertEquals(0, registry.subscriberCount("thread:7"))
        assertEquals(0, registry.subscriberCount("thread:8"))
    }

    /** Out-of-order or repeated publishes must not walk the cursor backwards. */
    @Test
    fun `the cursor only moves forward`() {
        val registry = UpdatesRegistry()
        registry.publish("thread:7", 100, UpdateKind.MESSAGE_CREATED)
        registry.publish("thread:7", 99, UpdateKind.MESSAGE_CREATED)

        assertEquals(100L, registry.cursorOf("thread:7"))
    }

    @Test
    fun `subscribing twice does not double-deliver`() {
        val registry = UpdatesRegistry()
        val sink = FakeSink(1)
        registry.subscribe("thread:7", sink, since = null)
        registry.subscribe("thread:7", sink, since = null)

        registry.publish("thread:7", 100, UpdateKind.MESSAGE_CREATED)

        assertEquals(listOf(100L), sink.seqs())
    }
}
