/*
 *  Description: Getting what is said to an agent into its program, and waking the program when it
 *               is gone. A screen outlives the program on it — Claude Code exits on a crash, an
 *               OOM kill, a `/quit` — so "the agent has a screen" was never the same as "the agent
 *               is listening".
 *
 *               **Knowing** an agent is dead: the applet reports `status = dead` when it sees
 *               tmux's dead-pane marker, and the machine reports session.error when a session is
 *               gone or cannot be driven. Those reported signals are the only evidence of death;
 *               silence is never read as death, since a slow line or a busy machine answers late
 *               and respawning would kill the program that was merely slow.
 *
 *               **Deciding** to revive: lazily, on the two moments a human needs the agent — being
 *               messaged and being watched — never as a background sweep. Waking is
 *               AgentService.wakeAgent (respawn in place, resume=true), rate-limited so a program
 *               that dies on every start is not relaunched in a loop; only wakes sent to a
 *               connected machine count against that budget. A wake held back by the back-off is
 *               retried when the back-off ends, so the last attempt — and the giving up after it —
 *               happen without anybody asking again.
 *
 *               **Delivering**: every message told to an agent has an id ("m<messageId>" for a chat
 *               message, "k<…>" for a keepalive) and stays in the agent's outstanding queue until
 *               its outcome is definite. The queue is in memory; each chat message in it also has
 *               an AgentPendingMessage row, and a server that starts finds the rows its
 *               predecessor left and marks those messages undelivered ("the server restarted
 *               before it was delivered"), since nothing will deliver them now.
 *                 - it is sent as `say(text, id)` while the agent is awake, and held while it is
 *                   asleep, dead or starting;
 *                 - the applet's rpc.result accepting it means it is queued there; a protocol 1
 *                   applet never reports more, so that is delivery — unless the value is `false`,
 *                   which is how a protocol 1 applet says it could not take it; a protocol 2
 *                   applet later calls `sayResult({id, ok, error})`;
 *                 - a send not yet accepted when the machine's connection closes or is replaced is
 *                   sent again on the next connection; an accepted one is sent again only when the
 *                   applet restarted (screenReady after a newer session.create than the send — see
 *                   HubScreen.generation). Otherwise the applet survived, and its sayResult may
 *                   have been lost with the old connection: unless one arrives within
 *                   [confirmGrace] of the reconnect, the message is failed with "the connection to
 *                   the machine broke before the agent confirmed it" (a sayResult arriving later
 *                   finds nothing to settle);
 *                 - definite failures are an rpc error, a refusal, sayResult ok=false, the
 *                   connection breaking before confirmation, the agent being closed and the wake
 *                   giving up. A chat message that fails is recorded with
 *                   MessageService.markUndelivered so its sender sees it. An offline machine is not
 *                   a failure: the message waits for it.
 *
 *               AgentWakeup:
 *                 tell(agent, text, id, messageId?) — say [text] to [agent]; see above.
 *                 deliverOn(machineId) — the machine (re)connected; send what waits for it.
 *                 ensureAwakeForViewer(sid) -> the sid to attach to; never waits on the machine.
 *                 isAwake(agentUserId) / ensureAwake(agentUserId) — liveness, and waking.
 *                 forget(agentUserId) — the agent was closed; what it still owed fails.
 *                 reportLostOnRestart() — at startup: what the previous process owed is undelivered.
 *
 *               Example: wakeup.tell(agent, prompt, "m41", 41L)
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.agent

import app.microteams.agent.screen.AgentScreenRepository
import app.microteams.agent.screen.AgentScreens
import app.microteams.agent.screen.ScreenAgent
import app.microteams.chat.message.MessageService
import app.microteams.machine.link.HubScreen
import app.microteams.machine.link.LinkClosedException
import app.microteams.machine.link.MachineHub
import app.microteams.machine.link.PROTOCOL_V2
import app.microteams.machine.link.ScreenFn
import app.microteams.machine.link.ScreenLifecycleListener
import app.microteams.machine.link.ScreenState
import app.microteams.machine.link.ScreenVarListener
import jakarta.annotation.PostConstruct
import jakarta.annotation.PreDestroy
import java.time.Duration
import java.time.Instant
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CompletionException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.locks.ReentrantLock
import org.rucca.cheese.common.persistent.IdType
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.ObjectProvider
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Component
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.TransactionDefinition
import org.springframework.transaction.support.TransactionTemplate

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
    private val messageService: MessageService,
    private val pendingMessages: AgentPendingMessageRepository,
    transactions: PlatformTransactionManager,
    // Late-bound: AgentService constructs the ScreenAgents that call back into here, so asking for
    // it eagerly would be a cycle. Nothing is resolved until the first wake.
    private val agentService: ObjectProvider<app.microteams.agent.screen.AgentService>,
    private val agentScreens: ObjectProvider<AgentScreens>,
    /**
     * Back-off between successive wakes of the same agent, in seconds; its length is how many wakes
     * are tried before giving up. A program that starts, dies, and is restarted immediately is a
     * busy loop that would hammer the machine and burn the agent's credits.
     */
    @Value("\${microteams.wakeup.backoff-seconds:0,15,60,300}") backoffSeconds: List<Long>,
    /** How long after a reconnect a surviving applet has to confirm a message it had accepted. */
    @Value("\${microteams.wakeup.confirm-grace-seconds:30}") confirmGraceSeconds: Long,
) {
    private val logger = LoggerFactory.getLogger(AgentWakeup::class.java)

    /** One wake at a time per agent, so three messages arriving together start one program. */
    private val locks = ConcurrentHashMap<IdType, ReentrantLock>()

    /**
     * One message on its way to an agent's program. Guarded by its agent's queue. [generation] is
     * the screen generation it was last sent under, null while it waits to be sent; [call] counts
     * its sends, so an answer to an older send is recognised and ignored.
     */
    private class Say(val id: String, val text: String, val messageId: IdType?) {
        var generation: Long? = null
        var call: Int = 0
        var accepted: Boolean = false

        /** The machine connection (its connectedAt) the applet accepted it on. */
        var acceptedOn: Instant? = null
    }

    /** What each agent still owes, oldest first. */
    private val outstanding = ConcurrentHashMap<IdType, MutableList<Say>>()

    /**
     * Agents whose screen a person opening it has just asked the machine about (an adopt of a
     * screen this server had forgotten): the death that answer may report is a death somebody is
     * waiting to see mended.
     */
    private val askedByViewer: MutableSet<IdType> = ConcurrentHashMap.newKeySet()

    private val attempts = ConcurrentHashMap<IdType, WakeAttempts>()

    private class WakeAttempts {
        @Volatile var count: Int = 0

        @Volatile var last: Instant = Instant.EPOCH
    }

    private val backoff = backoffSeconds.map(Duration::ofSeconds)

    private val maxAttempts = backoff.size

    /**
     * The wake budget resets once this has passed since the last wake — the agent stayed up rather
     * than merely reaching a prompt before dying again.
     */
    private val stableWindow = Duration.ofMinutes(30)

    private val confirmGrace = Duration.ofSeconds(confirmGraceSeconds)

    /**
     * A transaction of its own for the pending row: chat tells an agent after its commit, inside a
     * transaction that is finished, where a write would join it and never be committed.
     */
    private val ownTransaction =
        TransactionTemplate(transactions).also {
            it.propagationBehavior = TransactionDefinition.PROPAGATION_REQUIRES_NEW
        }

    /** Runs the back-off's retries and the confirmation deadlines. */
    private val timer = Executors.newSingleThreadScheduledExecutor { r ->
        Thread(r, "agent-wakeup").also { it.isDaemon = true }
    }

    /** Agents asked about while a wake of theirs was in progress, to be looked at once it ends. */
    private val lookAgain: MutableSet<IdType> = ConcurrentHashMap.newKeySet()

    /** The wake retry scheduled for an agent the back-off held back, at most one each. */
    private val retries = ConcurrentHashMap<IdType, ScheduledFuture<*>>()

    @PreDestroy
    fun stop() {
        timer.shutdownNow()
    }

    /**
     * Mark undelivered every chat message a previous server process still owed (its
     * AgentPendingMessage rows): its memory, and with it any chance of delivering them, is gone.
     * Runs at startup, before this server owes anything itself.
     */
    fun reportLostOnRestart() {
        for (row in pendingMessages.findAll()) {
            messageService.markUndelivered(
                row.messageId!!,
                row.agentUserId!!,
                "the server restarted before it was delivered",
            )
            pendingMessages.delete(row)
        }
    }

    @PostConstruct
    fun subscribe() {
        reportLostOnRestart()
        hub.addScreenLifecycleListener(
            object : ScreenLifecycleListener {
                override fun onScreenState(screen: HubScreen, previous: ScreenState) {
                    val agent = agentRegistry.bySid(screen.sid) ?: return
                    when (screen.state) {
                        // Back up and being driven: say everything that piled up while it was down.
                        ScreenState.LIVE -> {
                            askedByViewer.remove(agent.userId)
                            deliver(agent)
                        }
                        ScreenState.DEAD -> {
                            logger.info(
                                "agent {} died on screen {}: {}",
                                agent.userId,
                                screen.sid,
                                screen.deadReason,
                            )
                            onDeath(agent)
                        }
                        ScreenState.STARTING,
                        ScreenState.UNKNOWN -> {}
                    }
                }

                override fun onAppletReady(screen: HubScreen) {
                    val agent = agentRegistry.bySid(screen.sid) ?: return
                    appletRestarted(agent, screen.generation.get())
                }
            },
        )
        // The applet's own verdict. `status` is a driver-applet variable, so reading it as liveness
        // belongs to the agent module — the hub just forwards the push.
        hub.addScreenVarListener(
            ScreenVarListener { screen, name, value ->
                if (name != STATUS_VAR) return@ScreenVarListener
                if (value == STATUS_DEAD)
                    hub.markScreen(
                        screen.sid,
                        ScreenState.DEAD,
                        "the program exited (pane is dead)",
                    )
                else hub.markScreen(screen.sid, ScreenState.LIVE)
            },
        )
        hub.expose("sayResult", ScreenFn { _, screen, args -> sayResult(screen, args) })
    }

    // -- delivering -------------------------------------------------------------

    /** Say [text] to [agent] under [id]; [messageId] is the chat message it carries, if any. */
    fun tell(agent: ScreenAgent, text: String, id: String, messageId: IdType?) {
        if (messageId != null) {
            ownTransaction.executeWithoutResult {
                pendingMessages.save(
                    AgentPendingMessage().also {
                        it.messageId = messageId
                        it.agentUserId = agent.userId
                    },
                )
            }
        }
        queueOf(agent.userId).let { q -> synchronized(q) { q.add(Say(id, text, messageId)) } }
        deliver(agent)
    }

    /**
     * The machine said hello again: whatever waits for its agents can go out now, and what a
     * surviving applet accepted on an earlier connection must be confirmed within [confirmGrace].
     */
    fun deliverOn(machineId: String) {
        val now = hub.connectedAtOf(machineId)
        val v2 = hub.protocolOf(machineId) == PROTOCOL_V2
        for (agent in agentRegistry.screenAgents().filter { it.machineId == machineId }) {
            val q = outstanding[agent.userId]
            if (v2 && q != null) {
                synchronized(q) {
                    q.filter { it.accepted && it.acceptedOn != now }
                        .forEach { awaitConfirmation(agent, q, it) }
                }
            }
            deliver(agent)
        }
    }

    /** Called holding [q]: fail [say] unless it is settled or sent again within [confirmGrace]. */
    private fun awaitConfirmation(agent: ScreenAgent, q: MutableList<Say>, say: Say) {
        val call = say.call
        timer.schedule(
            {
                synchronized(q) {
                    if (say.call != call || !say.accepted || !q.remove(say)) return@schedule
                    failed(
                        agent.userId,
                        say,
                        "the connection to the machine broke before the agent confirmed it",
                    )
                }
            },
            confirmGrace.toMillis(),
            TimeUnit.MILLISECONDS,
        )
    }

    private fun queueOf(agentUserId: IdType): MutableList<Say> =
        outstanding.computeIfAbsent(agentUserId) { ArrayList() }

    /** Send every waiting message if the program can take it; otherwise make sure it is woken. */
    private fun deliver(agent: ScreenAgent) {
        val q = outstanding[agent.userId] ?: return
        if (!isAwake(agent.userId)) {
            if (synchronized(q) { q.any { it.messageId != null } }) ensureAwake(agent.userId)
            return
        }
        val screen = hub.screen(agent.sid) ?: return
        val generation = screen.generation.get()
        synchronized(q) {
            q.filter { it.generation == null }.forEach { send(agent, q, it, generation) }
        }
    }

    /** Called holding [q]. */
    private fun send(agent: ScreenAgent, q: MutableList<Say>, say: Say, generation: Long) {
        say.generation = generation
        say.accepted = false
        val call = ++say.call
        hub.callScreen(agent.machineId, agent.sid, "say", listOf(say.text, say.id))
            .whenCompleteAsync { value, e -> answered(agent, q, say, call, value, e) }
    }

    /** The applet's rpc.result to one send of [say], or the end of the connection it went on. */
    private fun answered(
        agent: ScreenAgent,
        q: MutableList<Say>,
        say: Say,
        call: Int,
        value: Any?,
        e: Throwable?,
    ) {
        val cause = (e as? CompletionException)?.cause ?: e
        val resend =
            synchronized(q) {
                if (say.call != call || say !in q) return
                when {
                    cause == null && value == false -> {
                        q.remove(say)
                        failed(agent.userId, say, "the agent's program could not take it")
                        false
                    }
                    cause == null -> {
                        say.accepted = true
                        say.acceptedOn = hub.connectedAtOf(agent.machineId)
                        // A protocol 1 applet never reports more than having taken it.
                        if (hub.protocolOf(agent.machineId) != PROTOCOL_V2) {
                            q.remove(say)
                            delivered(agent.userId, say)
                        }
                        false
                    }
                    cause is LinkClosedException -> {
                        say.generation = null
                        true
                    }
                    else -> {
                        q.remove(say)
                        failed(
                            agent.userId,
                            say,
                            "the agent's program refused it: ${cause.message}",
                        )
                        false
                    }
                }
            }
        if (resend) deliver(agent)
    }

    /** `sayResult({id, ok, error})`: a protocol 2 applet's final word on one message. */
    private fun sayResult(screen: HubScreen, args: List<Any?>): Any? {
        val result = args.firstOrNull() as? Map<*, *> ?: throw IllegalArgumentException("no result")
        val id = result["id"]?.toString() ?: throw IllegalArgumentException("no id")
        val agent = agentRegistry.bySid(screen.sid) ?: return null
        val q = outstanding[agent.userId] ?: return null
        synchronized(q) {
            val say = q.firstOrNull { it.id == id } ?: return null
            q.remove(say)
            if (result["ok"] == true) delivered(agent.userId, say)
            else {
                val error = result["error"]?.toString()?.ifBlank { null } ?: "no reason given"
                failed(agent.userId, say, "the agent's program could not take it: $error")
            }
        }
        return null
    }

    /**
     * A freshly loaded applet holds nothing sent before the session.create that loaded it, so those
     * sends go again; ones sent since reached this applet already.
     */
    private fun appletRestarted(agent: ScreenAgent, generation: Long) {
        val q = outstanding[agent.userId] ?: return
        synchronized(q) {
            for (say in q) {
                val sent = say.generation ?: continue
                if (sent < generation) {
                    say.generation = null
                    say.accepted = false
                    say.call++
                }
            }
        }
        deliver(agent)
    }

    /**
     * A death is worth a wake when somebody needs the agent: a message waits for it, or a person
     * opening its screen asked about it. A person who merely stays on a screen whose program dies
     * sees it dead until a message or the next opening wakes it. A keepalive owed to a dead program
     * is pointless and is dropped.
     */
    private fun onDeath(agent: ScreenAgent) {
        val q = outstanding[agent.userId]
        val waiting =
            q != null &&
                synchronized(q) {
                    q.removeAll { it.messageId == null }
                    q.isNotEmpty()
                }
        val asked = askedByViewer.remove(agent.userId)
        if (waiting || asked) ensureAwake(agent.userId)
    }

    /** Called holding the agent's queue, after removing [say] from it. */
    private fun delivered(agentUserId: IdType, say: Say) {
        logger.debug("agent {}: {} delivered", agentUserId, say.id)
        settle(agentUserId, say, null)
    }

    /** Called holding the agent's queue, after removing [say] from it. */
    private fun failed(agentUserId: IdType, say: Say, reason: String) {
        logger.warn("agent {}: {} not delivered: {}", agentUserId, say.id, reason)
        settle(agentUserId, say, reason)
    }

    /** Record [say]'s outcome: no longer pending, and undelivered when [reason] says why. */
    private fun settle(agentUserId: IdType, say: Say, reason: String?) {
        val messageId = say.messageId ?: return
        // Off this thread: it may be the machine's receive thread, which must not wait on the DB.
        CompletableFuture.runAsync {
            try {
                if (reason != null) messageService.markUndelivered(messageId, agentUserId, reason)
                pendingMessages.deleteByMessageIdAndAgentUserId(messageId, agentUserId)
            } catch (e: Exception) {
                logger.error("recording the outcome of message {} failed", messageId, e)
            }
        }
    }

    private fun failAll(agentUserId: IdType, reason: String) {
        val q = outstanding[agentUserId] ?: return
        synchronized(q) {
            q.forEach { failed(agentUserId, it, reason) }
            q.clear()
        }
    }

    // -- the live screen ----------------------------------------------------------

    /**
     * A human is opening the live screen on [sid]: make sure there is something to look at,
     * rebuilding whatever is missing from the persisted row, and waking a program known dead. It
     * never waits on the machine — whether the program is there is reported by the machine itself
     * (session.error) and by the applet's status. If something cannot be done it says so at ERROR,
     * because every failure downstream looks like the same blank terminal.
     *
     * Returns the sid to attach to: the same one in the normal case, since waking respawns in
     * place; a different one only where the screen had to be reopened from scratch.
     */
    fun ensureAwakeForViewer(sid: String): String =
        try {
            ensureScreen(sid)
        } catch (e: Exception) {
            logger.error(
                "live screen: could not ensure screen {} is live: {}",
                sid,
                e.toString(),
                e,
            )
            sid
        }

    private fun ensureScreen(sid: String): String {
        val row = agentScreenRepository.findById(sid).orElse(null)
        if (row == null) {
            // No agent owns this sid. A live screen of some other kind is fine (a shared shell is
            // nobody's agent); nothing at all is a viewer that will open onto blackness.
            if (hub.screen(sid) == null) {
                logger.error(
                    "live screen: screen {} has neither an agent row nor a live screen — nothing to show",
                    sid,
                )
            }
            return sid
        }
        // Its registration in the hub (so the machine layer can route to it) and as an agent (so
        // chat can reach it and the wake-up can find it) both follow from the row.
        val known = hub.screen(row.sid) != null && agentRegistry.get(row.agentUserId) != null
        if (!known) {
            logger.warn(
                "live screen: screen {} of agent {} was not live on this server; rebuilding it " +
                    "from its row",
                row.sid,
                row.agentUserId,
            )
        }
        if (agentScreens.getObject().adopt(row) == null) {
            logger.error(
                "live screen: cannot ensure screen {}: agent {} runs unknown driver '{}'",
                sid,
                row.agentUserId,
                row.driver,
            )
            return sid
        }
        // A screen this server had forgotten is asked about the same way a reconnect asks: the
        // adopt makes the machine report a session that is gone (session.error), without waiting.
        val driver = agentScreens.getObject().driverOf(row)
        if (!known && driver != null && hub.isOnline(row.machineId)) {
            askedByViewer.add(row.agentUserId)
            hub.readoptScreen(
                machineId = row.machineId,
                sid = row.sid,
                command = emptyList(),
                appletSource = driver.appletSource,
                vars = driver.vars,
            )
        }
        if (!isAwake(row.agentUserId) && !ensureAwake(row.agentUserId)) {
            logger.error(
                "live screen: agent {} on screen {} is not running and could not be woken (machine {} " +
                    "online: {})",
                row.agentUserId,
                row.sid,
                row.machineId,
                hub.isOnline(row.machineId),
            )
        }
        return (agentRegistry.get(row.agentUserId) as? ScreenAgent)?.sid ?: row.sid
    }

    // -- waking -------------------------------------------------------------------

    /**
     * Whether this agent can be typed at right now. A screen we have never heard from counts: the
     * applet speaks only when something changes, so silence is not evidence of death, and a send to
     * a screen that turns out gone is sent again once it is back. STARTING deliberately does not
     * count: a program still painting its first frames swallows what is typed at it.
     */
    fun isAwake(agentUserId: IdType): Boolean {
        val agent = agentRegistry.get(agentUserId) as? ScreenAgent ?: return false
        val screen = hub.screen(agent.sid) ?: return false
        if (!hub.isOnline(agent.machineId)) return false
        return screen.state == ScreenState.LIVE || screen.state == ScreenState.UNKNOWN
    }

    /** Whether a (re)start we asked for is still coming up — a second one would only fight it. */
    private fun isStarting(agentUserId: IdType): Boolean {
        val agent = agentRegistry.get(agentUserId) as? ScreenAgent ?: return false
        return hub.screen(agent.sid)?.state == ScreenState.STARTING
    }

    /**
     * Make sure the agent's program is running, waking it if not. Returns whether it is (or has
     * just been asked to be) awake. Concurrent callers serialise on the agent's lock, and a caller
     * that finds the wake already in progress reports success rather than queueing a second one.
     * Giving up on a program that keeps dying fails every message still owed to it.
     */
    fun ensureAwake(agentUserId: IdType): Boolean {
        if (isAwake(agentUserId) || isStarting(agentUserId)) return true
        val lock = locks.computeIfAbsent(agentUserId) { ReentrantLock() }
        if (!lock.tryLock()) {
            // Another thread is waking it; it looks again when it is done, so a death that lands
            // meanwhile is not lost.
            lookAgain.add(agentUserId)
            return true
        }
        try {
            if (isAwake(agentUserId) || isStarting(agentUserId)) return true
            val row = agentScreenRepository.findByAgentUserId(agentUserId).firstOrNull()
            if (row == null || !hub.isOnline(row.machineId)) return false
            val attempt = attempts.computeIfAbsent(agentUserId) { WakeAttempts() }
            if (Duration.between(attempt.last, Instant.now()) > stableWindow) attempt.count = 0
            if (attempt.count >= maxAttempts) {
                logger.warn(
                    "agent {} died {} times in a row; not waking it again until it stays up",
                    agentUserId,
                    attempt.count,
                )
                failAll(agentUserId, "the agent's program keeps exiting, so it was not restarted")
                return false
            }
            val left = backoff[attempt.count] - Duration.between(attempt.last, Instant.now())
            if (left > Duration.ZERO) {
                retryWake(agentUserId, left)
                return false
            }
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
            if (lookAgain.remove(agentUserId)) ensureAwake(agentUserId)
        }
    }

    /** Try [agentUserId]'s wake again once the back-off allows, unless a retry is already due. */
    private fun retryWake(agentUserId: IdType, after: Duration) {
        retries.computeIfAbsent(agentUserId) {
            logger.info(
                "agent {}: waking it again in {} s (back-off)",
                agentUserId,
                after.toSeconds() + 1,
            )
            timer.schedule(
                {
                    retries.remove(agentUserId)
                    ensureAwake(agentUserId)
                },
                after.toMillis(),
                TimeUnit.MILLISECONDS,
            )
        }
    }

    /** The agent was closed for good: what it still owed fails, and its bookkeeping goes. */
    fun forget(agentUserId: IdType) {
        retries.remove(agentUserId)?.cancel(false)
        lookAgain.remove(agentUserId)
        failAll(agentUserId, "the agent was closed")
        outstanding.remove(agentUserId)
        askedByViewer.remove(agentUserId)
        attempts.remove(agentUserId)
        locks.remove(agentUserId)
    }
}
