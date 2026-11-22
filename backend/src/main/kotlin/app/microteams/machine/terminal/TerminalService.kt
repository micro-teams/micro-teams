/*
 *  Description: Terminals and commands on a machine: opening, listing, reading and closing them,
 *               and adopting them again when their machine reconnects after a backend restart.
 *
 *               A terminal is a screen (machine/link) running the machine user's login shell; it
 *               is watched and typed into through the live screen like any screen. A command is a
 *               screen running one command through sh. The connector does not report when a
 *               program exits (the pane stays, so its output can still be read), so the wrapper
 *               prints a final marker line, EXIT_MARKER followed by the exit code, and reading a
 *               command's output is how its end is learned and recorded.
 *
 *               Reading a screen's text needs a viewer; [detail] subscribes a short-lived one at a
 *               size larger than any person's, so it never shrinks a window people are watching.
 *
 *               TerminalService (a Spring bean):
 *                 list(machineId) -> TerminalDTOs, oldest first.
 *                 open(machineId, userId, command?, cwd?) -> TerminalDTO — a terminal, or a command.
 *                 detail(machineId, sid) -> TerminalDetailDTO — with output when the machine is online:
 *                   the screen's text, less the exit marker, tmux's end-of-pane note and empty rows.
 *                 close(machineId, sid) — ends the program and forgets the row.
 *               EXIT_MARKER — the text a command's wrapper prints before its exit code.
 *
 *               Example: val c = terminals.open("m1", ann, "make test", null)
 *                        terminals.detail("m1", c.sid).finished
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.machine.terminal

import app.microteams.machine.MachineConnectedEvent
import app.microteams.machine.MachineForgottenEvent
import app.microteams.machine.TerminalNotFoundError
import app.microteams.machine.link.HubViewer
import app.microteams.machine.link.MachineHub
import app.microteams.machine.link.ViewerSink
import app.microteams.model.TerminalDTO
import app.microteams.model.TerminalDetailDTO
import java.time.ZoneOffset
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import org.rucca.cheese.common.error.BadRequestError
import org.rucca.cheese.common.persistent.IdType
import org.slf4j.LoggerFactory
import org.springframework.context.event.EventListener
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

const val EXIT_MARKER = "__MICROTEAMS_EXIT__="

private const val SCREEN_KIND = "terminal"

fun MachineTerminal.toDTO() =
    TerminalDTO(
        sid = sid,
        machineId = machineId,
        kind = TerminalDTO.Kind.valueOf(kind.name),
        command = command,
        openedBy = openedBy,
        createdAt = createdAt.atOffset(ZoneOffset.UTC),
        exitCode = exitCode,
    )

@Service
@Transactional
class TerminalService(
    private val terminals: MachineTerminalRepository,
    private val hub: MachineHub,
) {
    private val logger = LoggerFactory.getLogger(TerminalService::class.java)

    fun list(machineId: String): List<TerminalDTO> =
        terminals.findByMachineIdOrderByCreatedAt(machineId).map { it.toDTO() }

    fun open(machineId: String, userId: IdType, command: String?, cwd: String?): TerminalDTO {
        if (!hub.isOnline(machineId)) throw BadRequestError("machine $machineId is not connected")
        val kind = if (command.isNullOrBlank()) TerminalKind.TERMINAL else TerminalKind.COMMAND
        val screen = hub.openScreen(machineId, argv(kind, command), SCREEN_KIND, env = env(cwd))
        val row =
            MachineTerminal(
                sid = screen.sid,
                machineId = machineId,
                token = screen.token,
                kind = kind,
                command = command?.takeIf { kind == TerminalKind.COMMAND },
                cwd = cwd,
                openedBy = userId,
            )
        return terminals.save(row).toDTO()
    }

    fun detail(machineId: String, sid: String): TerminalDetailDTO {
        val row = row(machineId, sid)
        val screen = if (hub.isOnline(machineId) && hub.screen(sid) != null) capture(sid) else null
        if (row.kind == TerminalKind.COMMAND && row.exitCode == null && screen != null) {
            exitCodeIn(screen)?.let {
                row.exitCode = it
                terminals.save(row)
            }
        }
        return TerminalDetailDTO(
            terminal = row.toDTO(),
            finished = row.kind == TerminalKind.COMMAND && row.exitCode != null,
            output = screen?.let { readable(it) },
        )
    }

    fun close(machineId: String, sid: String) {
        val row = row(machineId, sid)
        if (hub.isOnline(machineId)) hub.closeScreen(machineId, sid)
        terminals.delete(row)
    }

    /** A machine came back: register its terminals with the hub again and re-drive them. */
    @EventListener
    fun onConnected(event: MachineConnectedEvent) {
        for (row in terminals.findByMachineId(event.machineId)) {
            if (hub.screen(row.sid) == null)
                hub.adoptScreen(row.sid, row.machineId, row.token, SCREEN_KIND)
            hub.readoptScreen(row.machineId, row.sid, argv(row.kind, row.command), "", env(row.cwd))
        }
    }

    @EventListener
    fun onForgotten(event: MachineForgottenEvent) {
        terminals.deleteByMachineId(event.machineId)
    }

    private fun row(machineId: String, sid: String): MachineTerminal =
        terminals.findById(sid).orElse(null)?.takeIf { it.machineId == machineId }
            ?: throw TerminalNotFoundError(sid)

    private fun argv(kind: TerminalKind, command: String?): List<String> =
        when (kind) {
            TerminalKind.TERMINAL ->
                listOf(
                    "sh",
                    "-c",
                    "cd \"\${MICROTEAMS_CWD:-\$HOME}\" && exec \"\${SHELL:-/bin/sh}\" -l",
                )
            TerminalKind.COMMAND ->
                listOf(
                    "sh",
                    "-c",
                    "cd \"\${MICROTEAMS_CWD:-\$HOME}\" || exit 1\n$command\nrc=\$?\nprintf '\\n$EXIT_MARKER%s\\n' \"\$rc\"\nexit \"\$rc\"",
                )
        }

    private fun env(cwd: String?): Map<String, String> =
        cwd?.let { mapOf("MICROTEAMS_CWD" to it) } ?: emptyMap()

    /**
     * What a person reads: the screen without the wrapper's exit marker, tmux's note that the pane
     * ended, and the empty rows below the last line (the capture is the whole 200-row window).
     */
    private fun readable(screen: String): String =
        screen
            .lineSequence()
            .filterNot { it.startsWith(EXIT_MARKER) || it.startsWith("Pane is dead") }
            .joinToString("\n")
            .trimEnd()

    private fun exitCodeIn(output: String): Int? =
        output
            .lineSequence()
            .lastOrNull { it.startsWith(EXIT_MARKER) }
            ?.removePrefix(EXIT_MARKER)
            ?.trim()
            ?.toIntOrNull()

    /** The screen's text, read through a viewer that exists for this one question. */
    private fun capture(sid: String): String? {
        val viewerId = "v" + UUID.randomUUID().toString().replace("-", "").take(8)
        val subscribed = CompletableFuture<Unit>()
        val text = CompletableFuture<String?>()
        return try {
            hub.attachViewer(sid, HubViewer(viewerId, CaptureSink(subscribed, text), 500, 200))
            subscribed.get(5, TimeUnit.SECONDS)
            hub.viewerCapture(sid, viewerId, "c1")
            text.get(5, TimeUnit.SECONDS)
        } catch (e: Exception) {
            logger.info("terminal {}: no output: {}", sid, e.toString())
            null
        } finally {
            hub.detachViewer(sid, viewerId)
        }
    }
}

/** A viewer that only listens for its subscription to take effect and for one capture. */
private class CaptureSink(
    private val subscribed: CompletableFuture<Unit>,
    private val text: CompletableFuture<String?>,
) : ViewerSink {
    override fun bytes(data: ByteArray) {}

    override fun size(cols: Int, rows: Int) {
        subscribed.complete(Unit)
    }

    override fun lease(holder: String) {}

    override fun capture(id: String, text: String?, error: String?) {
        this.text.complete(text)
    }

    override fun error(text: String) {
        this.text.complete(null)
    }
}
