/*
 *  Description: MachineHub — the server end of the frozen `link.Msg` protocol. One
 *               long-lived control channel per connected machine, over which the
 *               server opens *screens* (each a hosted CLI + applet), relays a
 *               screen's raw terminal to browser viewers, mirrors the applet's
 *               variables, answers the applet's calls, and runs one-shot `exec`
 *               on the machine. Ported field-for-field from the reference hub.py; the
 *               wire shape matches the frozen CLI's link.Msg contract exactly.
 *
 *               I/O-free by design: it depends only on two tiny transport interfaces,
 *               so it is exercised with in-process fakes (no WebSocket, no machine, no
 *               DB). The connector WS routes adapt real WebSockets to these interfaces
 *               and resolve the machine→agent actor via MachineService/attribution.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.machine.link

import java.util.Base64
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component

/** A live machine control channel. Satisfied by a WebSocket adapter and trivially fakeable. */
fun interface MachineTransport {
    fun sendJson(msg: LinkMsg)
}

/** A browser terminal viewer. It only ever *receives* raw screen bytes. */
fun interface ViewerTransport {
    fun sendBytes(data: ByteArray)
}

/** A applet→server function: (hub, screen, args) -> value. Exceptions become rpc errors. */
fun interface ScreenFn {
    fun call(hub: MachineHub, screen: HubScreen, args: List<Any?>): Any?
}

/**
 * One hosted process on a machine: a command, the terminal the server relays to viewers, and
 * optionally a applet driving it.
 *
 * A screen is deliberately NOT an agent. It carries no agent user and no team -- an agent is one
 * *kind* of thing that may run on a screen (see the agent module, which keeps the sid -> agent
 * mapping), and a screen may equally be a shared shell that belongs to nobody. [kind] is opaque
 * here: the machine layer never interprets it, it only lets the owning application recognise its
 * own screens.
 */
class HubScreen(
    val sid: String,
    val machineId: String,
    val command: List<String>,
    val token: String, // the MICROTEAMS_SCREEN value injected into the screen
    val kind: String,
) {
    val vars: MutableMap<String, Any?> = ConcurrentHashMap()
    val viewers: MutableSet<ViewerTransport> = ConcurrentHashMap.newKeySet()
}

/** The per-machine server-side state: its transport, its screens, and pending exec calls. */
class HubMachine(val machineId: String) {
    @Volatile var transport: MachineTransport? = null
    @Volatile var proto: Int? = null

    /**
     * The base URL this machine used to reach us on its *current* connection — reported by the CLI
     * on the control-channel handshake. The server stays URL-agnostic: it never assumes its own
     * address but echoes each machine's own endpoint back as MICROTEAMS_API, so two machines on the
     * same deployment reached via different endpoints (a public reverse proxy, an IPv4 relay, IPv6
     * direct, a campus network …) each drive their screens against the endpoint that works for
     * them.
     */
    @Volatile var origin: String? = null
    val screens: MutableMap<String, HubScreen> = ConcurrentHashMap()
    val execSeq = AtomicInteger(0)
    val callSeq = AtomicInteger(0)
    val execPending: MutableMap<String, CompletableFuture<ExecResult>> = ConcurrentHashMap()
    private val sendLock = ReentrantLock()

    /**
     * Serialize sends to one machine: a WebSocket is not safe for concurrent writes, and the
     * orchestrator, exec, and every viewer's fan-out all send here. Without this, interleaved
     * frames corrupt the channel.
     */
    fun send(msg: LinkMsg) {
        sendLock.withLock { transport?.sendJson(msg) }
    }
}

@Component
class MachineHub(screenFns: Map<String, ScreenFn> = emptyMap()) {
    private val logger = LoggerFactory.getLogger(MachineHub::class.java)
    private val machines: MutableMap<String, HubMachine> = ConcurrentHashMap()
    private val screens: MutableMap<String, HubScreen> = ConcurrentHashMap() // sid -> screen
    private val byScreenToken: MutableMap<String, HubScreen> = ConcurrentHashMap()
    private val fns: MutableMap<String, ScreenFn> = ConcurrentHashMap()

    init {
        fns["screenReady"] = ScreenFn { _, _, _ -> mapOf("ok" to true) }
        fns.putAll(screenFns)
    }

    private fun machine(machineId: String): HubMachine =
        machines.computeIfAbsent(machineId) { HubMachine(it) }

    // -- machine connection -------------------------------------------------

    fun attachMachine(machineId: String, transport: MachineTransport, origin: String? = null) {
        val machine = machine(machineId)
        machine.transport = transport
        // Record the endpoint the CLI dialed on this connection (null when an older client did not
        // report one); it becomes MICROTEAMS_API for screens opened while this connection lives.
        if (origin != null) machine.origin = origin
        machine.send(LinkMsg(t = "welcome", v = PROTOCOL_VERSION))
    }

    fun detachMachine(machineId: String, transport: MachineTransport) {
        val machine = machines[machineId]
        if (machine != null && machine.transport === transport) {
            machine.transport = null
        }
    }

    fun isOnline(machineId: String): Boolean = machines[machineId]?.transport != null

    /**
     * The base URL the machine reported on its live connection, or null (offline / not reported).
     */
    fun originOf(machineId: String): String? = machines[machineId]?.origin

    fun onlineMachineIds(): List<String> =
        machines.values.filter { it.transport != null }.map { it.machineId }

    // -- screens (server -> machine) ----------------------------------------

    /**
     * Open a screen of [kind] on a machine: mint its per-screen token and ship the optional applet,
     * mirroring web-claude's session.create. The token becomes MICROTEAMS_SCREEN inside the screen;
     * [env] is injected into its process environment.
     *
     * [appletSource] is null for a screen nobody drives -- a plain shell is just a command with a
     * terminal, and `source` is omitted from the frame exactly as the Go CLI's omitempty does.
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
        machine.send(
            LinkMsg(
                t = "session.create",
                sid = sid,
                command = command,
                screen = screen.token,
                cols = cols,
                rows = rows,
                source = appletSource,
                env = env?.ifEmpty { null },
            )
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

    /** Hot-reload the applet into a running screen — no restart, no lost CLI context. */
    fun reloadDriver(machineId: String, sid: String, source: String) {
        machine(machineId).send(LinkMsg(t = "script.load", sid = sid, source = source))
    }

    /**
     * Re-provision an already-adopted screen after the CLI reconnects: send an `adopt`
     * session.create so the client re-drives the *surviving* tmux session. The screen must already
     * be registered (via [adoptScreen]) so its token is known.
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
        machine(machineId)
            .send(
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
                )
            )
    }

    /** Push a forced self-update to a machine (it downloads + swaps its binary in place). */
    fun sendUpdate(machineId: String) {
        machine(machineId).send(LinkMsg(t = "update"))
    }

    /** Server→applet function call (say / choose / compact …). Fire-and-forget. */
    fun callScreen(machineId: String, sid: String, name: String, args: List<Any?>) {
        val machine = machine(machineId)
        val id = "srv" + machine.callSeq.incrementAndGet()
        machine.send(LinkMsg(t = "rpc.call", sid = sid, id = id, name = name, args = args))
    }

    fun screenByToken(token: String): HubScreen? = byScreenToken[token]

    /** Look up a screen by id (viewer route authz + machine routing). Read-only. */
    fun screen(sid: String): HubScreen? = screens[sid]

    /**
     * Re-register a screen the CLI is already running (after a server restart) — no session.create
     * is sent; the tmux session already exists on the machine.
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

    /** Every live screen, of every kind. Filtering by application concepts is the caller's job. */
    fun allOnlineScreens(): List<HubScreen> = screens.values.filter { isOnline(it.machineId) }

    // -- exec (server -> machine, awaited) ----------------------------------

    /**
     * One-shot command on the machine → {stdout, stderr, exit, truncated}. [timeoutSeconds] bounds
     * it machine-side; if even that plus a margin elapses we tell the machine to cancel and throw
     * [TimeoutException].
     */
    fun exec(
        machineId: String,
        argv: List<String>,
        cwd: String? = null,
        env: Map<String, String>? = null,
        timeoutSeconds: Long = 60,
        stdin: String? = null,
    ): ExecResult {
        val machine = machine(machineId)
        val eid = "e" + machine.execSeq.incrementAndGet()
        val fut = CompletableFuture<ExecResult>()
        machine.execPending[eid] = fut
        machine.send(
            LinkMsg(
                t = "exec",
                id = eid,
                command = argv,
                timeout = timeoutSeconds.toInt(),
                cwd = cwd,
                env = env?.ifEmpty { null },
                stdin = stdin,
            )
        )
        try {
            return fut.get(timeoutSeconds + 5, TimeUnit.SECONDS)
        } catch (e: TimeoutException) {
            machine.send(LinkMsg(t = "exec.cancel", id = eid))
            throw e
        } finally {
            machine.execPending.remove(eid)
        }
    }

    // -- viewers (browser <-> machine screen) -------------------------------

    /** Attach a browser viewer to a screen. The first viewer triggers a screen.subscribe. */
    fun attachViewer(
        machineId: String,
        sid: String,
        viewer: ViewerTransport,
        cols: Int = 120,
        rows: Int = 32,
    ) {
        val screen = requireScreen(machineId, sid)
        val first = screen.viewers.isEmpty()
        screen.viewers.add(viewer)
        if (first) {
            machine(machineId)
                .send(LinkMsg(t = "screen.subscribe", sid = sid, cols = cols, rows = rows))
        }
    }

    fun detachViewer(machineId: String, sid: String, viewer: ViewerTransport) {
        val screen = screens[sid] ?: return
        screen.viewers.remove(viewer)
        // Route to the screen's own machine, not the caller-supplied id, so a stale id can
        // never send an unsubscribe to the wrong machine.
        val machine = machine(screen.machineId)
        machine.send(LinkMsg(t = "var.set", sid = sid, name = "viewerLevel", value = "passive"))
        if (screen.viewers.isEmpty()) {
            machine.send(LinkMsg(t = "screen.unsubscribe", sid = sid))
        }
    }

    fun viewerInput(machineId: String, sid: String, data: ByteArray) {
        machine(machineId)
            .send(
                LinkMsg(
                    t = "screen.input",
                    sid = sid,
                    data = Base64.getEncoder().encodeToString(data),
                )
            )
    }

    fun viewerResize(machineId: String, sid: String, cols: Int, rows: Int) {
        machine(machineId).send(LinkMsg(t = "screen.resize", sid = sid, cols = cols, rows = rows))
    }

    /**
     * The viewer scrolling through the pane's history. The hosted program is a full-screen TUI with
     * no scrollback of its own -- the history lives in tmux -- so paging back drives tmux copy-mode
     * on the machine, never PgUp/PgDn into the program (which it ignores). "up"/"down" page the
     * scrollback; "bottom" returns to the live screen.
     */
    fun viewerScroll(machineId: String, sid: String, dir: String) {
        val d = if (dir in setOf("up", "down", "bottom")) dir else "bottom"
        machine(machineId).send(LinkMsg(t = "screen.scroll", sid = sid, dir = d))
    }

    /** The viewer's mode (passive / scroll / full) → the `viewerLevel` variable. */
    fun viewerControl(machineId: String, sid: String, level: String) {
        val lvl = if (level in setOf("passive", "scroll", "full")) level else "passive"
        machine(machineId)
            .send(LinkMsg(t = "var.set", sid = sid, name = "viewerLevel", value = lvl))
    }

    // -- machine -> server (inbound) ----------------------------------------

    /** Dispatch one inbound link.Msg from the machine — the server half of the CLI's loop. */
    fun onMachineMessage(machineId: String, m: LinkMsg) {
        val machine = machine(machineId)
        val sid = m.sid ?: ""
        val screen = machine.screens[sid]

        when (m.t) {
            "hello" -> {
                machine.proto = m.v
                if (machine.proto != null && machine.proto != PROTOCOL_VERSION) {
                    logger.warn(
                        "machine {} speaks protocol {} (server {})",
                        machineId,
                        machine.proto,
                        PROTOCOL_VERSION,
                    )
                }
            }
            "heartbeat",
            "session.ready",
            "session.error" -> {}
            "exec.result" -> {
                val fut = machine.execPending[m.id]
                if (fut != null && !fut.isDone) {
                    fut.complete(
                        ExecResult(
                            stdout = m.stdout ?: "",
                            stderr = m.stderr ?: "",
                            exit = m.exit ?: 0,
                            truncated = m.truncated ?: false,
                        )
                    )
                }
            }
            "var.push" -> {
                if (screen != null && m.name != null) screen.vars[m.name] = m.value
            }
            "screen.data" -> {
                if (screen != null) fanOutScreenData(screen, m.data ?: "")
            }
            "rpc.call" -> handleScreenCall(machine, screen, m)
        }
    }

    private fun fanOutScreenData(screen: HubScreen, dataB64: String) {
        val raw =
            try {
                Base64.getDecoder().decode(dataB64)
            } catch (e: IllegalArgumentException) {
                return
            }
        for (viewer in screen.viewers.toList()) {
            try {
                viewer.sendBytes(raw)
            } catch (e: Exception) {
                screen.viewers.remove(viewer)
            }
        }
    }

    private fun handleScreenCall(machine: HubMachine, screen: HubScreen?, m: LinkMsg) {
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
        machine.send(
            LinkMsg(
                t = "rpc.result",
                sid = m.sid,
                id = m.id,
                value = value,
                error = error.ifEmpty { null },
            )
        )
    }

    private fun requireScreen(machineId: String, sid: String): HubScreen =
        machine(machineId).screens[sid]
            ?: throw NoSuchElementException("no screen '$sid' on machine '$machineId'")
}
