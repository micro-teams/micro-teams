/*
 *  Description: A terminal or a command on a machine, as a row. Terminals belong to the machine,
 *               not to any team: whoever may use the machine lists, opens, watches and closes them.
 *               The row is what survives a backend restart (the hub's memory does not), so a
 *               terminal is adopted again when its machine reconnects (TerminalService).
 *
 *               TerminalKind — TERMINAL (a login shell) or COMMAND (one command, run through sh).
 *               MachineTerminal / MachineTerminalRepository — the row and its repository.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.machine.terminal

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.EnumType
import jakarta.persistence.Enumerated
import jakarta.persistence.Id
import jakarta.persistence.Index
import jakarta.persistence.Table
import java.time.LocalDateTime
import org.rucca.cheese.common.persistent.IdType
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.transaction.annotation.Transactional

enum class TerminalKind {
    TERMINAL,
    COMMAND,
}

// Hard-deleted when closed: a closed terminal is gone.
@Entity
@Table(name = "machine_terminal", indexes = [Index(columnList = "machine_id")])
class MachineTerminal(
    @Id @Column(name = "sid", length = 32) var sid: String = "",
    @Column(name = "machine_id", nullable = false, length = 64) var machineId: String = "",
    @Column(name = "token", nullable = false, length = 64) var token: String = "",
    @Enumerated(EnumType.STRING)
    @Column(name = "kind", nullable = false)
    var kind: TerminalKind = TerminalKind.TERMINAL,
    @Column(name = "command", columnDefinition = "TEXT") var command: String? = null,
    @Column(name = "cwd", columnDefinition = "TEXT") var cwd: String? = null,
    @Column(name = "opened_by", nullable = false) var openedBy: IdType = 0,
    @Column(name = "created_at", nullable = false)
    var createdAt: LocalDateTime = LocalDateTime.now(),
    @Column(name = "exit_code") var exitCode: Int? = null,
)

interface MachineTerminalRepository : JpaRepository<MachineTerminal, String> {
    fun findByMachineIdOrderByCreatedAt(machineId: String): List<MachineTerminal>

    fun findByMachineId(machineId: String): List<MachineTerminal>

    @Modifying @Transactional fun deleteByMachineId(machineId: String)
}
