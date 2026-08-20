/*
 *  Description: Unit tests for ViewerPump — the queue that keeps a slow browser from freezing a
 *               machine. No Spring, no WebSocket, no database: the whole point of the class is that
 *               it is I/O-free enough to be tested with a write function that simply refuses to
 *               return, which is precisely the situation production could not survive before.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.machine.screen

import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ViewerPumpTest {

    /**
     * The whole reason the class exists: a write that never returns must not hold up the caller.
     */
    @Test
    fun `offer does not block when the write is stuck`() {
        val stuck = CountDownLatch(1)
        val entered = CountDownLatch(1)
        val pump =
            ViewerPump(
                label = "stuck",
                write = {
                    entered.countDown()
                    stuck.await() // a browser that never drains
                },
                giveUp = {},
            )
        try {
            pump.offer("first".toByteArray())
            assertTrue(entered.await(2, TimeUnit.SECONDS), "the pump should have started writing")

            // With the writer parked, the machine thread keeps handing over bytes. If offer() went
            // anywhere near the write, this would hang and the test would time out.
            val done = CountDownLatch(1)
            Thread {
                    repeat(100) { pump.offer("more".toByteArray()) }
                    done.countDown()
                }
                .start()
            assertTrue(done.await(2, TimeUnit.SECONDS), "offer() blocked behind a stuck write")
        } finally {
            stuck.countDown()
            pump.close()
        }
    }

    @Test
    fun `bytes reach the socket in order`() {
        val written = LinkedBlockingQueue<String>()
        val pump = ViewerPump(label = "order", write = { written.put(String(it)) }, giveUp = {})
        try {
            listOf("a", "b", "c").forEach { pump.offer(it.toByteArray()) }
            assertEquals("a", written.poll(2, TimeUnit.SECONDS))
            assertEquals("b", written.poll(2, TimeUnit.SECONDS))
            assertEquals("c", written.poll(2, TimeUnit.SECONDS))
        } finally {
            pump.close()
        }
    }

    /**
     * A viewer that falls hopelessly behind is hung up on — NOT fed a stream with a hole in it.
     * Dropping bytes out of a terminal stream corrupts the picture until something repaints it, and
     * there is nothing in the protocol yet that can ask for a repaint.
     */
    @Test
    fun `a hopelessly slow viewer is hung up on rather than fed a broken stream`() {
        val stuck = CountDownLatch(1)
        val entered = CountDownLatch(1)
        val hungUp = CountDownLatch(1)
        val delivered = mutableListOf<ByteArray>()
        val pump =
            ViewerPump(
                label = "slow",
                capacityBytes = 1000,
                write = {
                    synchronized(delivered) { delivered.add(it) }
                    entered.countDown()
                    stuck.await()
                },
                giveUp = { hungUp.countDown() },
            )
        try {
            pump.offer(ByteArray(100)) // taken by the writer, which then parks
            assertTrue(entered.await(2, TimeUnit.SECONDS))

            var accepted = 0
            repeat(20) { if (pump.offer(ByteArray(100))) accepted++ }

            assertTrue(hungUp.await(2, TimeUnit.SECONDS), "the viewer should have been hung up on")
            assertTrue(pump.isClosed())
            assertTrue(accepted < 20, "the pump kept accepting past its limit")
            // Everything it did accept, it accepted whole — no partial stream was ever produced.
            assertTrue(
                synchronized(delivered) { delivered.all { it.size == 100 } },
                "a chunk was cut up",
            )
        } finally {
            stuck.countDown()
        }
    }

    @Test
    fun `offer is refused once the viewer is gone`() {
        val pump = ViewerPump(label = "gone", write = {}, giveUp = {})
        pump.close()
        assertFalse(pump.offer("late".toByteArray()))
    }

    /** A failing socket ends the same way as a hopeless one: hang up, do not spin on the error. */
    @Test
    fun `a write that throws hangs the viewer up`() {
        val hungUp = CountDownLatch(1)
        val writes = java.util.concurrent.atomic.AtomicInteger(0)
        val pump =
            ViewerPump(
                label = "broken",
                write = {
                    writes.incrementAndGet()
                    throw IllegalStateException("session closed")
                },
                giveUp = { hungUp.countDown() },
            )
        pump.offer("one".toByteArray())
        pump.offer("two".toByteArray())
        assertTrue(hungUp.await(2, TimeUnit.SECONDS))
        assertTrue(pump.isClosed())
        assertEquals(1, writes.get(), "the pump kept writing after the socket failed")
    }

    /**
     * Closing normally (the viewer left) must not hang up on a socket that is already going away.
     */
    @Test
    fun `a normal close does not call the hang-up`() {
        val hungUp = AtomicBoolean(false)
        val drained = CountDownLatch(1)
        val pump =
            ViewerPump(
                label = "left",
                write = { drained.countDown() },
                giveUp = { hungUp.set(true) },
            )
        pump.offer("bye".toByteArray())
        assertTrue(drained.await(2, TimeUnit.SECONDS))
        pump.close()
        Thread.sleep(100)
        assertFalse(hungUp.get())
    }

    @Test
    fun `the backlog empties as bytes go out`() {
        val gate = CountDownLatch(1)
        val wrote = CountDownLatch(1)
        val pump =
            ViewerPump(
                label = "backlog",
                write = {
                    gate.await()
                    wrote.countDown()
                },
                giveUp = {},
            )
        try {
            pump.offer(ByteArray(64))
            gate.countDown()
            assertTrue(wrote.await(2, TimeUnit.SECONDS))
            // Give the loop a moment to account for what it just wrote.
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2)
            while (pump.backlogBytes() != 0 && System.nanoTime() < deadline) Thread.sleep(10)
            assertEquals(0, pump.backlogBytes())
        } finally {
            pump.close()
        }
    }

    @Test
    fun `an empty chunk is not mistaken for the stop signal`() {
        val written = LinkedBlockingQueue<Int>()
        val pump = ViewerPump(label = "empty", write = { written.put(it.size) }, giveUp = {})
        try {
            pump.offer(ByteArray(0))
            pump.offer("still here".toByteArray())
            assertEquals(10, written.poll(2, TimeUnit.SECONDS))
        } finally {
            pump.close()
        }
    }

    @Test
    fun `chunks are handed to the socket unchanged`() {
        val written = LinkedBlockingQueue<ByteArray>()
        val pump = ViewerPump(label = "bytes", write = { written.put(it) }, giveUp = {})
        try {
            val esc = byteArrayOf(0x1b, 0x5b, 0x32, 0x4a) // ESC [ 2 J — clear screen
            pump.offer(esc)
            assertArrayEquals(esc, written.poll(2, TimeUnit.SECONDS))
        } finally {
            pump.close()
        }
    }
}
