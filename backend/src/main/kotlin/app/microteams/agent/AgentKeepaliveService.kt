/*
 *  Description: The moving half of cache keepalive: setting an agent's schedule, and the poller
 *               that fires it. See AgentKeepalive for why the schedule is persisted rather than
 *               held in memory (it must survive restarts).
 *
 *               The poll is deliberately dumb and idempotent: every tick it asks the row store for
 *               the schedules that are on and due, touches each, and advances its next-fire time.
 *               A backend that was down past a due time finds that row waiting on the first tick and
 *               touches it at once — recovery is just "it was already due". Because the schedule
 *               lives in the row and not in a timer, nothing about the cadence is lost across a
 *               restart.
 *
 *               A touch is a plain do-nothing message typed straight into the agent's program
 *               (ScreenAgent.say), NOT a group message and NOT routed through the wake-up: it is
 *               sent only while the agent is actually alive. Waking a dead agent to keep it warm
 *               would rebuild the very context this exists to preserve — the opposite of the point —
 *               so a dead agent is left dead and simply not touched. The next-fire time still
 *               advances so a long-dead agent is not probed on every single tick.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.agent

import app.microteams.agent.screen.ScreenAgent
import java.time.Instant
import org.rucca.cheese.common.error.BadRequestError
import org.rucca.cheese.common.persistent.IdType
import org.slf4j.LoggerFactory
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/**
 * The message a touch sends. It declares itself so a human reading the agent's transcript, and the
 * agent itself, both understand it is not work — the agent is told in plain terms to do nothing.
 */
private const val KEEPALIVE_MESSAGE =
    "[keepalive] This is an automated cache-keepalive message. Its only purpose is to refresh the " +
        "prefix cache's TTL so your context does not expire and have to be rebuilt. You do not " +
        "need to do anything, complete any task, or reply — please ignore this message."

@Service
class AgentKeepaliveService(
    private val repository: AgentKeepaliveRepository,
    private val agentRegistry: AgentRegistry,
    private val wakeup: AgentWakeup,
) {
    private val logger = LoggerFactory.getLogger(AgentKeepaliveService::class.java)

    /** The current schedule for an agent, or null if it has never had one. */
    fun get(agentUserId: IdType): AgentKeepalive? = repository.findById(agentUserId).orElse(null)

    /**
     * Turn keepalive on or off for an agent and set its interval. Enabling requires a positive
     * interval and arms the next fire one interval out; the interval is deliberately unbounded —
     * the operator knows the ~1h cache TTL and it may itself change with Claude Code, so we do not
     * bake a limit into the schema. Disabling keeps the remembered interval but disarms the timer.
     */
    @Transactional
    fun setKeepalive(
        agentUserId: IdType,
        enabled: Boolean,
        intervalSeconds: Long?,
    ): AgentKeepalive {
        val row = repository.findById(agentUserId).orElse(AgentKeepalive(agentUserId = agentUserId))
        if (enabled) {
            val interval =
                intervalSeconds
                    ?: row.intervalSeconds.takeIf { it > 0 }
                    ?: throw BadRequestError("intervalSeconds is required when enabling keepalive")
            if (interval <= 0) throw BadRequestError("intervalSeconds must be positive")
            row.enabled = true
            row.intervalSeconds = interval
            // Arm from now, not from any stale nextFireAt, so re-enabling starts a fresh interval
            // rather than firing immediately off an old due time.
            row.nextFireAt = Instant.now().plusSeconds(interval)
        } else {
            row.enabled = false
            row.nextFireAt = null
            intervalSeconds?.let { if (it > 0) row.intervalSeconds = it }
        }
        return repository.save(row)
    }

    /**
     * Fire every schedule that is on and due, then advance it. Runs on a fixed delay (not a fixed
     * rate) so ticks never overlap. The backend runs as a single instance, so no cross-node locking
     * is needed; a due row is claimed by advancing its nextFireAt before the next tick can see it.
     */
    @Scheduled(fixedDelayString = "\${microteams.keepalive.poll-ms:15000}")
    @Transactional
    fun tick() {
        val now = Instant.now()
        val due = repository.findByEnabledTrueAndNextFireAtLessThanEqual(now)
        for (row in due) {
            try {
                touch(row.agentUserId)
                row.lastFireAt = now
            } catch (e: Exception) {
                logger.warn("keepalive touch for agent {} failed: {}", row.agentUserId, e.message)
            } finally {
                // Advance regardless of whether the touch landed, so a dead or unreachable agent is
                // retried next interval, not hammered every tick.
                row.nextFireAt = Instant.now().plusSeconds(row.intervalSeconds)
                repository.save(row)
            }
        }
    }

    /** Type the keepalive message into the agent's program — only if it is actually alive. */
    private fun touch(agentUserId: IdType) {
        if (!wakeup.isAwake(agentUserId)) {
            logger.debug("keepalive: agent {} is not alive; skipping touch", agentUserId)
            return
        }
        val agent = agentRegistry.get(agentUserId) as? ScreenAgent ?: return
        agent.say(KEEPALIVE_MESSAGE)
        logger.debug("keepalive: touched agent {}", agentUserId)
    }
}
