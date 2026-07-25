/*
 *  Description: Waking an agent whose program is no longer running. A screen outlives the program
 *               on it — Claude Code exits on a crash, an OOM kill, a `/quit`, an out-of-credit
 *               error, and the tmux pane stays behind holding its corpse — so "the agent has a
 *               screen" was never the same as "the agent is listening". Before this, a message
 *               said to a dead agent was typed into a dead pane and silently lost, and 现场 opened
 *               onto a frozen screenful of whatever killed it.
 *
 *               Two things live here, and only these two. **Knowing** an agent is dead: the applet
 *               already reports `status = dead` when it sees tmux's dead-pane marker, and the
 *               machine reports a session.error when it cannot drive a session at all (which is
 *               what a tmux that did not survive a reboot looks like on the re-adopt path) — this
 *               is the one place that reads those two signals as "the program is gone", because
 *               what a driver's status values mean is agent knowledge, not the machine layer's.
 *               And **deciding** to revive: lazily, on the two moments a human actually needs the
 *               agent — 发消息 and 看现场 — never as a background resurrection sweep, so an agent
 *               nobody is talking to stays quietly dead instead of being restarted forever.
 *
 *               Waking is AgentService.wakeAgent (respawn in place, same session, resume=true), and
 *               it is rate-limited: a program that dies immediately on every start must not be
 *               relaunched in a loop, so repeated deaths back off and eventually give up until the
 *               screen proves it can stay alive.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.agent

import app.microteams.agent.screen.AgentScreenRepository
import app.microteams.agent.screen.ScreenAgent
import app.microteams.machine.link.HubScreen
import app.microteams.machine.link.MachineHub
import app.microteams.machine.link.ScreenLifecycleListener
import app.microteams.machine.link.ScreenVarListener
import jakarta.annotation.PostConstruct
import java.time.Duration
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.locks.ReentrantLock
import org.rucca.cheese.common.persistent.IdType
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.ObjectProvider
import org.springframework.stereotype.Component

/**
 * The mirrored variable every screen applet owns to say what the program is doing, and the one
 * value of it that means the program is no longer there. Its vocabulary is part of the applet
 * contract (see the applets module's screen drivers), which the agent module owns.
 */
private const val STATUS_VAR = "status"

private const val STATUS_DEAD = "dead"

@Component
class AgentWakeup(
    private val hub: MachineHub,
    private val agentRegistry: AgentRegistry,
    private val agentScreenRepository: AgentScreenRepository,
    // Late-bound: AgentService constructs the ScreenAgents that call back into here, so asking for
    // it eagerly would be a cycle. Nothing is resolved until the first wake.
    private val agentService: ObjectProvider<app.microteams.agent.screen.AgentService>,
) {
    private val logger = LoggerFactory.getLogger(AgentWakeup::class.java)

    /** One wake at a time per agent, so three messages arriving together start one program. */
    private val locks = ConcurrentHashMap<IdType, ReentrantLock>()

    /** What we tried to say while the program was down, delivered once it is back. */
    private val pending = ConcurrentHashMap<IdType, ConcurrentLinkedQueue<String>>()

    private val attempts = ConcurrentHashMap<IdType, WakeAttempts>()

    private class WakeAttempts {
        @Volatile var count: Int = 0

        @Volatile var last: Instant = Instant.EPOCH
    }

    /**
     * Back-off between successive wakes of the same agent, and how many we try before giving up. A
     * program that starts, dies, and is restarted immediately is a busy loop that would hammer the
     * machine and burn the agent's credits; a program that dies once an hour is just a crash worth
     * papering over.
     *
     * The budget resets once [stableWindow] has passed since the last wake — i.e. the agent stayed
     * up rather than merely reaching a prompt before dying again. Resetting on "reported alive"
     * instead would defeat the whole thing: a program that starts, announces itself and dies a
     * second later would clear its own budget on every cycle and be relaunched forever.
     */
    private val backoff = listOf(0L, 15L, 60L, 300L).map(Duration::ofSeconds)

    private val maxAttempts = backoff.size

    private val stableWindow = Duration.ofMinutes(30)

    @PostConstruct
    fun subscribe() {
        hub.addScreenLifecycleListener(
            object : ScreenLifecycleListener {
                override fun onScreenDead(screen: HubScreen, reason: String) {
                    val agent = agentRegistry.bySid(screen.sid) ?: return
                    logger.info("agent {} died on screen {}: {}", agent.userId, screen.sid, reason)
                    // Only wake right away if something is already waiting to be said; otherwise
                    // let it lie until somebody wants it (发消息 / 看现场).
                    if (!pending[agent.userId].isNullOrEmpty()) ensureAwake(agent.userId)
                }

                override fun onScreenAlive(screen: HubScreen) {
                    val agent = agentRegistry.bySid(screen.sid) ?: return
                    flush(agent)
                }
            }
        )
        // The applet's own verdict. `status` is a driver-applet variable, so reading it as liveness
        // belongs to the agent module — the hub just forwards the push.
        hub.addScreenVarListener(
            ScreenVarListener { screen, name, value ->
                if (name != STATUS_VAR) return@ScreenVarListener
                if (value == STATUS_DEAD) hub.markScreenDead(screen.sid, "pane is dead")
                else hub.markScreenAlive(screen.sid)
            }
        )
    }

    // -- the two trigger points ---------------------------------------------

    /**
     * Say something to an agent, waking it first if its program is gone. The message is queued and
     * typed once the applet reports the new program ready, because a `--resume` takes seconds to
     * paint a prompt and anything typed before that lands in a terminal that is still starting.
     */
    fun tell(agent: ScreenAgent, message: String) {
        if (isAwake(agent.userId)) {
            agent.say(message)
            return
        }
        pending.computeIfAbsent(agent.userId) { ConcurrentLinkedQueue() }.add(message)
        if (!ensureAwake(agent.userId)) {
            // Nothing could be woken (machine offline, out of attempts). The message stays queued:
            // if the machine comes back and the screen reports ready, it is delivered then.
            logger.warn(
                "agent {} could not be woken; {} message(s) queued",
                agent.userId,
                pending[agent.userId]?.size,
            )
        }
    }

    /**
     * A human is opening 现场 on [sid]. Wake the agent behind it if its program has died, so what
     * they get is a live terminal rather than the frozen last frame of a crash. Returns the sid to
     * attach to — the same one in the normal case, since waking respawns in place; a new one only
     * on the fallback path where the screen had to be reopened from scratch.
     */
    fun ensureAwakeForViewer(sid: String): String {
        val agent = agentRegistry.bySid(sid) ?: return sid
        probe(agent.sid)
        ensureAwake(agent.userId)
        return agentRegistry.get(agent.userId)?.let { (it as? ScreenAgent)?.sid } ?: sid
    }

    // -- mechanics -----------------------------------------------------------

    /**
     * Ask the applet for a screenful, purely to find out whether anything answers. Every death
     * signal we get for free is *reported* — the applet noticing a dead pane, the machine refusing
     * an adopt — and one case reports nothing at all: a tmux session that vanished while the
     * machine stayed connected (killed by hand, an OOM reaper, a `tmux kill-server`). Nobody is
     * left to say so, and no variable ever changes again, so the screen would look alive forever. A
     * call that goes unanswered is that case: the host silently drops an rpc for a session it no
     * longer has.
     *
     * Only silence counts as death — an empty snapshot does not, since a program that is merely
     * still starting paints nothing either. Reserved for 现场, where a stale screen is what the human
     * is staring at and a second of latency is affordable; the message path relies on the reported
     * signals instead of probing on every message.
     */
    private fun probe(sid: String) {
        val screen = hub.screen(sid) ?: return
        if (!screen.alive || !hub.isOnline(screen.machineId)) return
        val answer = hub.callScreenAwait(screen.machineId, sid, "snapshot", timeoutSeconds = 2)
        if (answer == null) hub.markScreenDead(sid, "the applet did not answer")
    }

    /** Whether this agent's program is, as far as we know, running and able to be typed at. */
    fun isAwake(agentUserId: IdType): Boolean {
        val agent = agentRegistry.get(agentUserId) as? ScreenAgent ?: return false
        val screen = hub.screen(agent.sid) ?: return false
        return hub.isOnline(agent.machineId) && screen.alive
    }

    /**
     * Make sure the agent's program is running, waking it if not. Returns whether it is (or has
     * just been asked to be) awake. Idempotent and safe to call from anywhere: concurrent callers
     * serialise on the agent's lock, and a caller that finds the wake already in progress simply
     * reports success rather than queueing a second one behind it.
     */
    fun ensureAwake(agentUserId: IdType): Boolean {
        if (isAwake(agentUserId)) return true
        val lock = locks.computeIfAbsent(agentUserId) { ReentrantLock() }
        if (!lock.tryLock()) return true // another thread is already waking it
        try {
            if (isAwake(agentUserId)) return true
            if (agentScreenRepository.findByAgentUserId(agentUserId).isEmpty()) return false
            val attempt = attempts.computeIfAbsent(agentUserId) { WakeAttempts() }
            if (Duration.between(attempt.last, Instant.now()) > stableWindow) attempt.count = 0
            if (attempt.count >= maxAttempts) {
                logger.warn(
                    "agent {} died {} times in a row; not waking it again until it stays up",
                    agentUserId,
                    attempt.count,
                )
                return false
            }
            val wait = backoff[attempt.count]
            if (Duration.between(attempt.last, Instant.now()) < wait) return false
            attempt.count++
            attempt.last = Instant.now()
            return try {
                agentService.getObject().wakeAgent(agentUserId)
            } catch (e: Exception) {
                logger.warn("waking agent {} failed: {}", agentUserId, e.message)
                false
            }
        } finally {
            lock.unlock()
        }
    }

    /** Type everything that piled up while the program was down, oldest first. */
    private fun flush(agent: ScreenAgent) {
        val queue = pending[agent.userId] ?: return
        while (true) {
            val message = queue.poll() ?: break
            agent.say(message)
        }
    }

    /** Drop an agent's bookkeeping when it is closed for good. */
    fun forget(agentUserId: IdType) {
        pending.remove(agentUserId)
        attempts.remove(agentUserId)
        locks.remove(agentUserId)
    }
}
