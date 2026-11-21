/*
 *  Description: MachineHub — the server end of the connector protocol (see LinkProtocol.kt). One
 *               long-lived control channel per connected machine, over which the server opens
 *               *screens* (each a hosted program + an optional applet), relays a screen's terminal
 *               to the people watching it, mirrors the applet's variables and answers its calls.
 *
 *               A machine speaks protocol 1 or 2, fixed by its `hello`; nothing screen-related is
 *               sent to it before that, which is why a machine counts as attached only from its
 *               hello on. Protocol 2 gives every viewer its own stream, size, lease state and
 *               capture; protocol 1 shares one stream among all viewers and is mapped onto the same
 *               viewer interface here, so callers never branch on the version.
 *
 *               The applet watches `viewerLevel`: "full" while a person has the input, when it
 *               holds back what it is told to type, and "passive" otherwise; leaving "full" is when
 *               it returns the pane to its live bottom. Protocol 1 sets it full while a viewer
 *               types; protocol 2 derives it from the input lease, full exactly while a viewer
 *               holds it, and sets it again after every session.create and every screenReady.
 *
 *               I/O-free by design: it depends only on small transport interfaces, so it is
 *               exercised with in-process fakes (no WebSocket, no machine, no DB).
 *
 *               Public surface:
 *               MachineTransport  sendJson(msg) — one machine's control channel.
 *               ViewerSink        what a viewer is told: bytes / size / lease / capture / error,
 *                                 and resubscribed() when its subscription is made again.
 *               HubViewer(id, sink, cols, rows)  one person watching a screen, by viewer id.
 *               ScreenFn          an applet -> server function; exceptions become rpc errors.
 *               HubScreen, ScreenState, ScreenLifecycleListener, ScreenVarListener — a screen,
 *                                 what is known about its program, and who is told about it.
 *               LinkClosedException  how a call ends whose machine connection went away.
 *               HubMachine        one machine's state: its current transport and protocol, what it
 *                                 reported (origin, build, connectedAt), its screens and its calls
 *                                 awaiting rpc.result; send(msg) writes to the current transport.
 *               MachineHub:
 *                 addScreenLifecycleListener / addScreenVarListener — be told about screens.
 *                 attachMachine(id, transport, protocol, origin?) / detachMachine(id, transport)
 *                   — after the machine's hello; detach only if that transport is still current.
 *                 isOnline / originOf / buildOf / connectedAtOf / protocolOf / screensOf /
 *                 onlineMachineIds — what is known about a machine.
 *                 openScreen / closeScreen / readoptScreen / respawnScreen / adoptScreen —
 *                   a screen's life; readopt and respawn resubscribe every attached viewer.
 *                 sendUpdate(machineId) — ask the connector to update its own binary.
 *                 callScreen(machineId, sid, name, args) -> CompletableFuture of the applet's value.
 *                 screen(sid) / screenByToken(token) / allOnlineScreens() — look screens up.
 *                 expose(name, fn) — answer an applet's call `name`.
 *                 attachViewer(sid, viewer) / detachViewer / viewerInput / viewerReply /
 *                 viewerResize / viewerAck / viewerLease / viewerCapture — a viewer, in either
 *                 protocol;
 *                 viewerScroll / viewerControl — protocol 1 only.
 *                 markScreen(sid, state, reason?) — record what is known about a program.
 *                 onMachineMessage(machineId, msg, from?) — every inbound message; an applet's call
 *                   is answered on the transport [from] it came in on.
 *
 *               Example:
 *                 hub.attachMachine("m1", transport, PROTOCOL_V2)
 *                 val screen = hub.openScreen("m1", listOf("bash"), kind = "shell")
 *                 hub.attachViewer(screen.sid, HubViewer("v1a2b3c4d", sink, 120, 32))
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.machine.link

import java.time.Instant
import java.util.Base64
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component

/** A live machine control channel. Satisfied by a WebSocket adapter and trivially fakeable. */
fun interface MachineTransport {
    fun sendJson(msg: LinkMsg)
}

/**
 * Everything a viewer is told, in the order the machine said it. Implementations must not block:
 * they are called on the machine's receive thread (the viewer WebSocket queues them).
 */
interface ViewerSink {
    /** Terminal bytes for this viewer. */
    fun bytes(data: ByteArray)

    /** The terminal's size from now on; always before any bytes at that size. */
    fun size(cols: Int, rows: Int)

    /** Who holds the input lease: "" free, "driver" the applet, otherwise a viewer id. */
    fun lease(holder: String)

    /** The answer to capture [id]: the screen's text, or why there is none. */
    fun capture(id: String, text: String?, error: String?)

    /** Something failed for this viewer; the screen itself is fine. */
    fun error(text: String)

    /**
     * The viewer was subscribed again (a readopt or respawn): what the machine says next repeats
     * its state rather than answering anything the viewer did.
     */
    fun resubscribed() {}
}

/**
 * One person watching a screen. [id] is the viewer id the machine routes by (protocol 2); [cols] x
 * [rows] is the room the viewer last said it has.
 */
class HubViewer(val id: String, val sink: ViewerSink, cols: Int, rows: Int) {
    @Volatile var cols: Int = cols

    @Volatile var rows: Int = rows

    /** Protocol 1 only: this viewer typed or took the lease, so it wants `viewerLevel` full. */
    @Volatile var typing: Boolean = false
}

/** A applet→server function: (hub, screen, args) -> value. Exceptions become rpc errors. */
fun interface ScreenFn {
    fun call(hub: MachineHub, screen: HubScreen, args: List<Any?>): Any?
}

/** A call to a machine that can no longer be answered: its connection closed or was replaced. */
class LinkClosedException(message: String) : RuntimeException(message)

/**
 * One hosted process on a machine: a command, the terminal the server relays to viewers, and
 * optionally a applet driving it.
 *
 * A screen is deliberately NOT an agent. It carries no agent user and no team -- an agent is one
 * *kind* of thing that may run on a screen (see the agent module, which keeps the sid -> agent
 * mapping), and a screen may equally be a shared shell that belongs to nobody. [kind] is opaque
 * here: the machine layer never interprets it, it only lets the owning application recognise its
 * own screens.
 *
 * [generation] counts the session.create messages sent for this screen. A connector handles one
 * screen's messages in order and loads the applet while handling a create, so anything sent after
 * the latest create reaches the applet that create loaded; the agent module uses it to tell which
 * of its calls an applet restart lost.
 */
class HubScreen(
    val sid: String,
    val machineId: String,
    val command: List<String>,
    val token: String, // the MICROTEAMS_SCREEN value injected into the screen
    val kind: String,
) {
    val vars: MutableMap<String, Any?> = ConcurrentHashMap()
    val viewers: MutableMap<String, HubViewer> = ConcurrentHashMap()
    val generation = AtomicLong(0)

    /** What we last observed about the program on this screen. See [ScreenState]. */
    @Volatile var state: ScreenState = ScreenState.UNKNOWN

    /** Why it was last declared dead (for logs / diagnostics); null unless [state] is DEAD. */
    @Volatile var deadReason: String? = null

    /** The `viewerLevel` last set. */
    @Volatile internal var level: String = "passive"

    /** Protocol 2 only: who holds the input lease, as the machine last said ("" free). */
    @Volatile internal var leaseHolder: String = ""

    /** Protocol 1 only: the window size last asked for. */
    @Volatile internal var v1Cols: Int = 120
    @Volatile internal var v1Rows: Int = 32
}

/**
 * What is known about the program on a screen — four states rather than a boolean, because the
 * three things a caller does about it are genuinely different and a boolean forced two of them to
 * share a value.
 *
 * The distinction that matters is between not knowing and knowing it is gone. A screen we have
 * merely never heard from may well be running perfectly (the applet only speaks when something
 * changes), so treating that as death would restart healthy agents; a screen we know is gone must
 * not be typed at. And a screen we have just asked to start is neither: it is coming up, so nothing
 * should be typed at it yet and nothing should ask for it to be started again.
 */
enum class ScreenState {
    /** Never heard from. Assume it is there — the applet speaks only when something changes. */
    UNKNOWN,

    /** We asked the machine to (re)start the program; it has not announced itself yet. */
    STARTING,

    /** The applet is driving a running program: what is typed here reaches it. */
    LIVE,

    /** The program is gone. Anything typed here is lost; it must be started before it is used. */
    DEAD,
}

/**
 * Told when what is known about a screen's program changes. The machine layer knows nothing about
 * what runs on a screen, so it never acts on the change — it publishes it, and the module that
 * opened the screen decides whether a death is worth reviving (see the agent module's wake-up).
 *
 * Changes may come either from the wire (a machine reporting a session gone, an applet announcing
 * itself) or from the owning module's own verdict via [MachineHub.markScreen].
 *
 * [onAppletReady] is told every time an applet announces itself (`screenReady`), whether or not the
 * state changes: an applet that loads again has lost whatever the one before it held.
 */
fun interface ScreenLifecycleListener {
    fun onScreenState(screen: HubScreen, previous: ScreenState)

    fun onAppletReady(screen: HubScreen) {}
}

/** Told whenever a screen's applet pushes a new value for a variable it owns. */
fun interface ScreenVarListener {
    fun onScreenVar(screen: HubScreen, name: String, value: Any?)
}

/**
 * The per-machine server-side state: the transport of its current connection and the protocol
 * spoken on it, what it reported about itself, its screens, and the calls awaiting rpc.result.
 */
class HubMachine(val machineId: String) {
    @Volatile var transport: MachineTransport? = null

    /** The protocol this server speaks to the machine, from its hello. */
    @Volatile var proto: Int = PROTOCOL_V1

    /**
     * The base URL this machine used to reach us on its *current* connection — reported by the CLI
     * on the control-channel handshake. The server stays URL-agnostic: it never assumes its own
     * address but echoes each machine's own endpoint back as MICROTEAMS_API, so two machines on the
     * same deployment reached via different endpoints each drive their screens against the endpoint
     * that works for them.
     */
    @Volatile var origin: String? = null

    /**
     * Which build of the connector this machine is running, as it reported when asked. Null means
     * it has not answered — unknown, never "old".
     */
    @Volatile var build: String? = null

    /** When this machine last attached. Null if it has not connected since this server started. */
    @Volatile var connectedAt: Instant? = null

    val screens: MutableMap<String, HubScreen> = ConcurrentHashMap()
    val callSeq = AtomicInteger(0)

    /** Server→applet calls awaiting their `rpc.result`, on the current connection. */
    val callPending: MutableMap<String, CompletableFuture<Any?>> = ConcurrentHashMap()
    private val sendLock = ReentrantLock()

    /**
     * Serialize sends to one machine: a WebSocket is not safe for concurrent writes, and the
     * orchestrator and every viewer send here.
     *
     * A machine's session can already be closed when an unrelated event (a viewer detaching, a
     * readopt after a burst of reconnects) sends to it, and the container then throws
     * IllegalStateException. One missed message is resynced by the next attach, so it is logged
     * rather than allowed to fail the caller.
     */
    fun send(msg: LinkMsg) {
        try {
            sendLock.withLock { transport?.sendJson(msg) }
        } catch (e: IllegalStateException) {
            logger.warn(
                "dropped a send to a machine whose control-link session was already closed: ${e.message}",
            )
        }
    }

    /**
     * Write to [via], a connection of this machine that may no longer be its current one: an
     * applet's call is answered on the connection it came in on. A connection that has closed
     * meanwhile drops the answer, logged.
     */
    fun sendOn(via: MachineTransport, msg: LinkMsg) {
        if (via === transport) return send(msg)
        try {
            synchronized(via) { via.sendJson(msg) }
        } catch (e: IllegalStateException) {
            logger.warn("dropped {} for machine {}: its old connection is closed", msg.t, machineId)
        }
    }

    /** End every call still waiting on this machine; their connection is gone. */
    fun failPending(reason: String) {
        val calls = callPending.values.toList()
        callPending.clear()
        calls.forEach { it.completeExceptionally(LinkClosedException(reason)) }
    }

    companion object {
        private val logger = LoggerFactory.getLogger(HubMachine::class.java)
    }
}

@Component
class MachineHub(screenFns: Map<String, ScreenFn> = emptyMap()) {
    private val logger = LoggerFactory.getLogger(MachineHub::class.java)
    private val machines: MutableMap<String, HubMachine> = ConcurrentHashMap()
    private val screens: MutableMap<String, HubScreen> = ConcurrentHashMap() // sid -> screen
    private val byScreenToken: MutableMap<String, HubScreen> = ConcurrentHashMap()
    private val fns: MutableMap<String, ScreenFn> = ConcurrentHashMap()
    private val lifecycleListeners = CopyOnWriteArrayList<ScreenLifecycleListener>()
    private val varListeners = CopyOnWriteArrayList<ScreenVarListener>()

    init {
        // An applet announcing itself is the one unambiguous "the program is up and being driven"
        // signal on the wire, so it also clears a death recorded before this (re)start.
        fns["screenReady"] = ScreenFn { _, screen, _ ->
            lifecycleListeners.forEach { l -> safely { l.onAppletReady(screen) } }
            markScreen(screen.sid, ScreenState.LIVE)
            machines[screen.machineId]?.let { if (it.proto >= PROTOCOL_V2) sendLevel(it, screen) }
            mapOf("ok" to true)
        }
        fns.putAll(screenFns)
    }

    /**
     * Be told when what is known about a screen's program changes, and when an applet announces
     * itself. Listeners must not throw; one that does is logged.
     */
    fun addScreenLifecycleListener(listener: ScreenLifecycleListener) {
        lifecycleListeners.add(listener)
    }

    /** Be told when an applet pushes a variable it owns; called on the machine's receive thread. */
    fun addScreenVarListener(listener: ScreenVarListener) {
        varListeners.add(listener)
    }

    /** Answer an applet's `rpc.call` named [name] with [fn]. */
    fun expose(name: String, fn: ScreenFn) {
        fns[name] = fn
    }

    /**
     * Record what is now known about the program on [sid], and tell the listeners what changed.
     * Idempotent: a state that does not change publishes nothing, so a repeated signal can never
     * re-trigger whatever the owning module does about it.
     */
    fun markScreen(sid: String, state: ScreenState, reason: String? = null) {
        val screen = screens[sid] ?: return
        val previous = screen.state
        if (previous == state) return
        screen.state = state
        screen.deadReason = if (state == ScreenState.DEAD) reason else null
        if (state == ScreenState.DEAD) {
            logger.info(
                "screen {} on machine {} is dead: {}",
                sid,
                screen.machineId,
                reason ?: "no reason given",
            )
        }
        lifecycleListeners.forEach { l -> safely { l.onScreenState(screen, previous) } }
    }

    private inline fun safely(block: () -> Unit) {
        try {
            block()
        } catch (e: Exception) { // a listener must never break the control channel
            logger.warn("screen listener failed: {}", e.message)
        }
    }

    private fun machine(machineId: String): HubMachine =
        machines.computeIfAbsent(machineId) { HubMachine(it) }

    // -- machine connection -------------------------------------------------

    /**
     * A machine said hello on [transport], announcing [protocol]: from now on it is online and is
     * spoken to in that version. Calls still waiting on an earlier connection can no longer be
     * answered, so they end here.
     */
    fun attachMachine(
        machineId: String,
        transport: MachineTransport,
        protocol: Int,
        origin: String? = null,
    ) {
        val machine = machine(machineId)
        machine.failPending("the machine connected again")
        machine.transport = transport
        machine.proto = if (protocol >= PROTOCOL_V2) PROTOCOL_V2 else PROTOCOL_V1
        // The endpoint the CLI dialed on this connection (null when it did not report one); it
        // becomes MICROTEAMS_API for screens opened while this connection lives.
        if (origin != null) machine.origin = origin
        machine.connectedAt = Instant.now()
        logger.info(
            "machine {} speaks protocol {} (announced {})",
            machineId,
            machine.proto,
            protocol,
        )
        machine.send(LinkMsg(t = "welcome", v = machine.proto))
        // Ask which build it runs, right after an update has had the chance to replace it. A
        // connector that does not know the question never answers, which reads as "unknown".
        machine.send(LinkMsg(t = "machine.info"))
    }

    fun detachMachine(machineId: String, transport: MachineTransport) {
        val machine = machines[machineId]
        if (machine != null && machine.transport === transport) {
            machine.transport = null
            machine.failPending("the machine disconnected")
        }
    }

    fun isOnline(machineId: String): Boolean = machines[machineId]?.transport != null

    /** The base URL the machine reported on its live connection, or null. */
    fun originOf(machineId: String): String? = machines[machineId]?.origin

    /** The connector build this machine reported, or null if it has not said. */
    fun buildOf(machineId: String): String? = machines[machineId]?.build

    fun connectedAtOf(machineId: String): Instant? = machines[machineId]?.connectedAt

    /** The protocol spoken to this machine, or null if it never said hello to this server. */
    fun protocolOf(machineId: String): Int? =
        machines[machineId]?.takeIf { it.connectedAt != null }?.proto

    /** How many screens this machine currently holds. */
    fun screensOf(machineId: String): Int = machines[machineId]?.screens?.size ?: 0

    fun onlineMachineIds(): List<String> =
        machines.values.filter { it.transport != null }.map { it.machineId }

    // -- screens (server -> machine) ----------------------------------------

    /**
     * Send a session.create. On protocol 2 the new session knows no viewer and so no lease, and
     * `viewerLevel` follows at once: the connector handles one screen's messages in order, so the
     * applet the create loads observes it from its start.
     */
    private fun create(machine: HubMachine, screen: HubScreen, msg: LinkMsg) {
        screen.generation.incrementAndGet()
        machine.send(msg)
        if (machine.proto < PROTOCOL_V2) return
        screen.leaseHolder = ""
        screen.level = "passive"
        sendLevel(machine, screen)
    }

    /**
     * Open a screen of [kind] on a machine: mint its per-screen token and ship the optional applet.
     * The token becomes MICROTEAMS_SCREEN inside the screen; [env] is injected into its process
     * environment. [appletSource] is null for a screen nobody drives.
     */
    fun openScreen(
        machineId: String,
        command: List<String>,
        kind: String,
        appletSource: String? = null,
        env: Map<String, String>? = null,
        cols: Int = 120,
        rows: Int = 32,
    ): HubScreen {
        val machine = machine(machineId)
        val sid = "s" + UUID.randomUUID().toString().replace("-", "").take(8)
        val screen =
            HubScreen(
                sid = sid,
                machineId = machineId,
                command = command,
                token = UUID.randomUUID().toString().replace("-", ""),
                kind = kind,
            )
        machine.screens[sid] = screen
        screens[sid] = screen
        byScreenToken[screen.token] = screen
        screen.state = ScreenState.STARTING // we asked for it; its applet will confirm
        create(
            machine,
            screen,
            LinkMsg(
                t = "session.create",
                sid = sid,
                command = command,
                screen = screen.token,
                cols = cols,
                rows = rows,
                source = appletSource,
                env = env?.ifEmpty { null },
            ),
        )
        return screen
    }

    /** Close a screen: tell the machine to end the session and forget it here. */
    fun closeScreen(machineId: String, sid: String): Boolean {
        val machine = machine(machineId)
        val screen = machine.screens.remove(sid) ?: return false
        screens.remove(sid)
        byScreenToken.remove(screen.token)
        machine.send(LinkMsg(t = "session.close", sid = sid))
        return true
    }

    /**
     * Re-provision an already-registered screen after the machine (re)connects: an `adopt`
     * session.create makes the connector re-drive the surviving tmux session, or report it gone.
     * The connector remembers no viewer from before, so every attached viewer is subscribed again.
     */
    fun readoptScreen(
        machineId: String,
        sid: String,
        command: List<String>,
        appletSource: String,
        env: Map<String, String>? = null,
        cols: Int = 120,
        rows: Int = 32,
    ) {
        val screen = screens[sid] ?: return
        val machine = machine(machineId)
        create(
            machine,
            screen,
            LinkMsg(
                t = "session.create",
                sid = sid,
                command = command,
                screen = screen.token,
                cols = cols,
                rows = rows,
                source = appletSource,
                adopt = true,
                env = env?.ifEmpty { null },
            ),
        )
        resubscribe(machine, screen)
    }

    /**
     * Restart the program on an existing screen *in place*: end the machine's session and create it
     * again under the SAME sid and the same screen token, so everything that names the screen keeps
     * working across the restart. The connector handles one screen's messages in order, so the
     * create always finds the sid free and spawns fresh.
     *
     * The screen goes to STARTING rather than LIVE: a `--resume` takes seconds to paint a usable
     * prompt. The new session knows no viewer, so every attached viewer is subscribed again.
     */
    fun respawnScreen(
        machineId: String,
        sid: String,
        command: List<String>,
        appletSource: String? = null,
        env: Map<String, String>? = null,
        cols: Int = 120,
        rows: Int = 32,
    ): Boolean {
        val machine = machine(machineId)
        val screen = machine.screens[sid] ?: return false
        machine.send(LinkMsg(t = "session.close", sid = sid))
        create(
            machine,
            screen,
            LinkMsg(
                t = "session.create",
                sid = sid,
                command = command,
                screen = screen.token,
                cols = cols,
                rows = rows,
                source = appletSource,
                env = env?.ifEmpty { null },
            ),
        )
        screen.vars.clear() // the old program's status/tokens/… say nothing about the new one
        markScreen(sid, ScreenState.STARTING)
        resubscribe(machine, screen)
        return true
    }

    /**
     * Subscribe every viewer of [screen] again, each with its own id and size (v1: one, shared).
     */
    private fun resubscribe(machine: HubMachine, screen: HubScreen) {
        val viewers = screen.viewers.values.toList()
        if (viewers.isEmpty()) return
        viewers.forEach { it.sink.resubscribed() }
        if (machine.proto >= PROTOCOL_V2) {
            for (v in viewers) {
                machine.send(subscribeMsg(screen.sid, v.id, v.cols, v.rows))
            }
        } else {
            viewers.forEach { it.sink.size(screen.v1Cols, screen.v1Rows) }
            machine.send(subscribeMsg(screen.sid, null, screen.v1Cols, screen.v1Rows))
        }
    }

    private fun subscribeMsg(sid: String, viewer: String?, cols: Int, rows: Int) =
        LinkMsg(t = "screen.subscribe", sid = sid, viewer = viewer, cols = cols, rows = rows)

    /** Push a forced self-update to a machine (it downloads + swaps its binary in place). */
    fun sendUpdate(machineId: String) {
        machine(machineId).send(LinkMsg(t = "update"))
    }

    /**
     * Call the applet function [name] on screen [sid]. The future completes with the applet's
     * value, exceptionally with the applet's error, or with [LinkClosedException] when the
     * machine's connection closes or is replaced first (at once if it is offline). It never times
     * out by itself; a caller that needs a bound adds one.
     */
    fun callScreen(
        machineId: String,
        sid: String,
        name: String,
        args: List<Any?>,
    ): CompletableFuture<Any?> {
        val fut = CompletableFuture<Any?>()
        val machine = machines[machineId]
        if (machine?.transport == null) {
            fut.completeExceptionally(LinkClosedException("the machine is offline"))
            return fut
        }
        val id = "srv" + machine.callSeq.incrementAndGet()
        machine.callPending[id] = fut
        fut.whenComplete { _, _ -> machine.callPending.remove(id) }
        machine.send(LinkMsg(t = "rpc.call", sid = sid, id = id, name = name, args = args))
        return fut
    }

    /** The screen whose MICROTEAMS_SCREEN token is [token] — how a program on it is recognised. */
    fun screenByToken(token: String): HubScreen? = byScreenToken[token]

    /** The screen [sid], or null if this server does not know it. */
    fun screen(sid: String): HubScreen? = screens[sid]

    /**
     * Register a screen the machine may already be running (after a server restart) — no
     * session.create is sent here; the caller re-adopts it.
     */
    fun adoptScreen(sid: String, machineId: String, token: String, kind: String): HubScreen {
        val machine = machine(machineId)
        val screen =
            HubScreen(
                sid = sid,
                machineId = machineId,
                command = emptyList(),
                token = token,
                kind = kind,
            )
        machine.screens[sid] = screen
        screens[sid] = screen
        byScreenToken[token] = screen
        return screen
    }

    /**
     * Every screen whose machine is online, of every kind. Filtering by application concepts is the
     * caller's job.
     */
    fun allOnlineScreens(): List<HubScreen> = screens.values.filter { isOnline(it.machineId) }

    // -- viewers (browser <-> machine screen) -------------------------------

    private fun viewerTarget(sid: String): Pair<HubScreen, HubMachine>? {
        val screen = screens[sid] ?: return null
        // Route to the screen's own machine, so a stale id can never reach the wrong one.
        return screen to machine(screen.machineId)
    }

    /**
     * Attach [viewer] to screen [sid] and subscribe it at its size. Protocol 2 gives it its own
     * tmux client, which paints it whole. Protocol 1 shares one client; its window follows the last
     * size asked for, which is echoed to this viewer before the subscribe so the size comes first.
     */
    fun attachViewer(sid: String, viewer: HubViewer) {
        val (screen, machine) =
            viewerTarget(sid) ?: throw NoSuchElementException("no screen '$sid'")
        if (machine.proto >= PROTOCOL_V2) {
            screen.viewers[viewer.id] = viewer
            machine.send(subscribeMsg(sid, viewer.id, viewer.cols, viewer.rows))
        } else {
            screen.v1Cols = viewer.cols
            screen.v1Rows = viewer.rows
            viewer.sink.size(viewer.cols, viewer.rows)
            screen.viewers[viewer.id] = viewer
            machine.send(subscribeMsg(sid, null, viewer.cols, viewer.rows))
        }
    }

    /**
     * Detach viewer [viewerId]. Protocol 2 unsubscribes it, which also frees a lease it held (and
     * the machine tells that only to the viewers left, possibly none). Protocol 1 drops
     * `viewerLevel` when nobody typing is left and unsubscribes the shared client with the last
     * viewer.
     */
    fun detachViewer(sid: String, viewerId: String) {
        val (screen, machine) = viewerTarget(sid) ?: return
        val viewer = screen.viewers.remove(viewerId) ?: return
        if (machine.proto >= PROTOCOL_V2) {
            machine.send(LinkMsg(t = "screen.unsubscribe", sid = sid, viewer = viewerId))
            if (screen.leaseHolder == viewerId) v2Lease(screen, machine, "")
            return
        }
        viewer.typing = false
        v1Level(screen, machine)
        if (screen.viewers.isEmpty()) machine.send(LinkMsg(t = "screen.unsubscribe", sid = sid))
    }

    fun viewerInput(sid: String, viewerId: String, data: ByteArray) {
        val (screen, machine) = viewerTarget(sid) ?: return
        val b64 = Base64.getEncoder().encodeToString(data)
        if (machine.proto >= PROTOCOL_V2) {
            machine.send(LinkMsg(t = "screen.input", sid = sid, viewer = viewerId, data = b64))
            return
        }
        screen.viewers[viewerId]?.typing = true
        v1Level(screen, machine)
        machine.send(LinkMsg(t = "screen.input", sid = sid, data = b64))
    }

    /**
     * The viewer's terminal answering a query from tmux (device attributes, cursor position).
     * Protocol 2 lets it past the lease (`op: "reply"`); protocol 1 has no lease, and an answer is
     * not the viewer typing, so `viewerLevel` is left as it is.
     */
    fun viewerReply(sid: String, viewerId: String, data: ByteArray) {
        val (_, machine) = viewerTarget(sid) ?: return
        val b64 = Base64.getEncoder().encodeToString(data)
        if (machine.proto >= PROTOCOL_V2) {
            machine.send(
                LinkMsg(t = "screen.input", sid = sid, viewer = viewerId, data = b64, op = "reply"),
            )
        } else {
            machine.send(LinkMsg(t = "screen.input", sid = sid, data = b64))
        }
    }

    /**
     * The room viewer [viewerId] has changed. Protocol 1 shares one window, which follows the last
     * resize, so every viewer is told the new size.
     */
    fun viewerResize(sid: String, viewerId: String, cols: Int, rows: Int) {
        val (screen, machine) = viewerTarget(sid) ?: return
        val viewer = screen.viewers[viewerId] ?: return
        viewer.cols = cols
        viewer.rows = rows
        if (machine.proto >= PROTOCOL_V2) {
            machine.send(
                LinkMsg(
                    t = "screen.resize",
                    sid = sid,
                    viewer = viewerId,
                    cols = cols,
                    rows = rows,
                ),
            )
            return
        }
        screen.v1Cols = cols
        screen.v1Rows = rows
        screen.viewers.values.forEach { v -> tell(machine, screen, v) { it.size(cols, rows) } }
        machine.send(LinkMsg(t = "screen.resize", sid = sid, cols = cols, rows = rows))
    }

    /** The viewer rendered [n] more bytes. Protocol 1 has no flow control, so it is dropped. */
    fun viewerAck(sid: String, viewerId: String, n: Int) {
        val (_, machine) = viewerTarget(sid) ?: return
        if (machine.proto < PROTOCOL_V2 || n <= 0) return
        machine.send(LinkMsg(t = "screen.ack", sid = sid, viewer = viewerId, n = n))
    }

    /**
     * Take, renew or release the input lease. Protocol 1 has no lease; there a take or renew makes
     * the screen's `viewerLevel` full and a release lets it fall back to passive.
     */
    fun viewerLease(sid: String, viewerId: String, op: String) {
        val (screen, machine) = viewerTarget(sid) ?: return
        if (op !in setOf("take", "renew", "release")) return
        if (machine.proto >= PROTOCOL_V2) {
            machine.send(LinkMsg(t = "screen.lease", sid = sid, viewer = viewerId, op = op))
            return
        }
        screen.viewers[viewerId]?.typing = op != "release"
        v1Level(screen, machine)
    }

    /** Ask for the screen's text. A protocol 1 connector cannot answer, and the viewer is told. */
    fun viewerCapture(sid: String, viewerId: String, id: String) {
        val (screen, machine) = viewerTarget(sid) ?: return
        if (machine.proto >= PROTOCOL_V2) {
            machine.send(LinkMsg(t = "screen.capture", sid = sid, viewer = viewerId, id = id))
            return
        }
        screen.viewers[viewerId]
            ?.sink
            ?.capture(id, null, "this machine's connector is too old to copy from; update it")
    }

    /**
     * Protocol 1 only: page the pane's tmux history (copy-mode). "up"/"down" page the scrollback;
     * "bottom" returns to the live screen. On protocol 2 the wheel is mouse input instead.
     */
    fun viewerScroll(sid: String, dir: String) {
        val (_, machine) = viewerTarget(sid) ?: return
        if (machine.proto >= PROTOCOL_V2) return
        val d = if (dir in setOf("up", "down", "bottom")) dir else "bottom"
        machine.send(LinkMsg(t = "screen.scroll", sid = sid, dir = d))
    }

    /** Protocol 1 only: an older client setting the viewer mode (passive / scroll / full). */
    fun viewerControl(sid: String, level: String) {
        val (screen, machine) = viewerTarget(sid) ?: return
        if (machine.proto >= PROTOCOL_V2) return
        screen.level = if (level in setOf("passive", "scroll", "full")) level else "passive"
        sendLevel(machine, screen)
    }

    /** Protocol 1: `viewerLevel` is full while any viewer is typing; set only when it changes. */
    private fun v1Level(screen: HubScreen, machine: HubMachine) {
        val level = if (screen.viewers.values.any { it.typing }) "full" else "passive"
        if (level == screen.level) return
        screen.level = level
        sendLevel(machine, screen)
    }

    /**
     * Protocol 2: the lease is now [holder]'s ("" free, "driver" the applet, otherwise a viewer),
     * and `viewerLevel` is full exactly while a viewer holds it; set only when it changes.
     */
    private fun v2Lease(screen: HubScreen, machine: HubMachine, holder: String) {
        screen.leaseHolder = holder
        val level = if (holder != "" && holder != "driver") "full" else "passive"
        if (level == screen.level) return
        screen.level = level
        sendLevel(machine, screen)
    }

    private fun sendLevel(machine: HubMachine, screen: HubScreen) {
        machine.send(
            LinkMsg(t = "var.set", sid = screen.sid, name = "viewerLevel", value = screen.level),
        )
    }

    // -- machine -> server (inbound) ----------------------------------------

    /**
     * Dispatch one inbound message from an attached machine, received on [from] (null: on its
     * current connection).
     */
    fun onMachineMessage(machineId: String, m: LinkMsg, from: MachineTransport? = null) {
        val machine = machine(machineId)
        val sid = m.sid ?: ""
        val screen = machine.screens[sid]

        when (m.t) {
            // One shape for anything a machine can tell us about itself.
            "machine.info" -> {
                if (m.name == "version")
                    machine.build = m.value?.toString()?.takeIf { it.isNotBlank() }
            }
            // The machine could not (re)drive this session, or the session ended: the wire's own
            // death notice, and the module that owns the screen is told.
            "session.error" -> {
                if (screen != null) markScreen(sid, ScreenState.DEAD, deathReason(machine, m))
            }
            "var.push" -> {
                if (screen != null && m.name != null) {
                    screen.vars[m.name] = m.value
                    varListeners.forEach { l -> safely { l.onScreenVar(screen, m.name, m.value) } }
                }
            }
            "rpc.result" -> {
                val fut = machine.callPending[m.id]
                if (fut != null && !fut.isDone) {
                    if (m.error.isNullOrEmpty()) fut.complete(m.value)
                    else fut.completeExceptionally(RuntimeException(m.error))
                }
            }
            "screen.data" -> {
                if (screen == null) return
                val raw = decode(m.data) ?: return
                if (m.viewer == null)
                    screen.viewers.values.forEach { v ->
                        tell(machine, screen, v) { it.bytes(raw) }
                    }
                else toViewer(machine, screen, m) { it.bytes(raw) }
            }
            "screen.size" ->
                if (screen != null && m.cols != null && m.rows != null)
                    toViewer(machine, screen, m) { it.size(m.cols, m.rows) }
            "screen.lease.state" -> {
                if (screen == null) return
                v2Lease(screen, machine, m.holder ?: "")
                toViewer(machine, screen, m) { it.lease(m.holder ?: "") }
            }
            "screen.capture.result" -> {
                if (screen == null) return
                val text = m.data?.let { decode(it)?.toString(Charsets.UTF_8) }
                toViewer(machine, screen, m) {
                    it.capture(
                        m.id ?: "",
                        text ?: if (m.error.isNullOrEmpty()) "" else null,
                        m.error?.ifEmpty { null },
                    )
                }
            }
            "screen.error" ->
                if (screen != null) toViewer(machine, screen, m) { it.error(m.error ?: "error") }
            "rpc.call" -> handleScreenCall(machine, screen, m, from)
        }
    }

    /**
     * Why a session.error means the program is gone. A protocol 1 connector answers an adopt of a
     * session that did not survive by trying to spawn the adopt's empty command, and reports that
     * failure; the truth is that the program is no longer running.
     */
    private fun deathReason(machine: HubMachine, m: LinkMsg): String =
        if (machine.proto < PROTOCOL_V2 && m.error == "terminal: empty command")
            "the screen's program is no longer running on this machine"
        else m.error ?: "session error"

    private fun decode(b64: String?): ByteArray? =
        try {
            Base64.getDecoder().decode(b64 ?: "")
        } catch (e: IllegalArgumentException) {
            logger.warn("dropping a frame whose data is not base64")
            null
        }

    private fun toViewer(
        machine: HubMachine,
        screen: HubScreen,
        m: LinkMsg,
        block: (ViewerSink) -> Unit,
    ) {
        val viewer = screen.viewers[m.viewer ?: ""]
        if (viewer == null) {
            logger.debug("{} for viewer {} of {}, which is not attached", m.t, m.viewer, screen.sid)
            return
        }
        tell(machine, screen, viewer) { block(viewer.sink) }
    }

    /**
     * Tell one viewer something. A sink that throws is detached, and on protocol 2 the machine is
     * told so too, or it would keep that viewer's client and its lease share alive.
     */
    private inline fun tell(
        machine: HubMachine,
        screen: HubScreen,
        viewer: HubViewer,
        block: (ViewerSink) -> Unit,
    ) {
        try {
            block(viewer.sink)
        } catch (e: Exception) {
            logger.warn(
                "viewer {} of {} failed, detaching it: {}",
                viewer.id,
                screen.sid,
                e.toString(),
            )
            if (screen.viewers.remove(viewer.id) != null && machine.proto >= PROTOCOL_V2) {
                machine.send(
                    LinkMsg(t = "screen.unsubscribe", sid = screen.sid, viewer = viewer.id),
                )
                if (screen.leaseHolder == viewer.id) v2Lease(screen, machine, "")
            }
        }
    }

    private fun handleScreenCall(
        machine: HubMachine,
        screen: HubScreen?,
        m: LinkMsg,
        from: MachineTransport?,
    ) {
        val name = m.name ?: ""
        val args = m.args ?: emptyList()
        var value: Any? = null
        var error = ""
        val fn = fns[name]
        if (fn == null || screen == null) {
            error = "unknown function '$name'"
        } else {
            try {
                value = fn.call(this, screen, args)
            } catch (exc: Exception) { // a applet call must never crash the channel
                error = exc.message ?: exc.javaClass.simpleName
            }
        }
        val result =
            LinkMsg(
                t = "rpc.result",
                sid = m.sid,
                id = m.id,
                value = value,
                error = error.ifEmpty { null },
            )
        if (from == null) machine.send(result) else machine.sendOn(from, result)
    }
}
