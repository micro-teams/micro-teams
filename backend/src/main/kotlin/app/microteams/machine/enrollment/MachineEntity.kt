/*
 *  Description: This file defines the Machine entity and its repository. A machine
 *               is an enrolled machine that hosts a real CLI (Claude Code) via the
 *               frozen `microteams` connector binary. It carries a durable token and,
 *               unlike the reference design, has NO owner user: a machine is bound to
 *               teams (see TeamMachine), and every member of any associated team has
 *               equal rights over it.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.machine.enrollment

import jakarta.persistence.*
import java.time.LocalDateTime
import java.util.Optional
import org.springframework.data.jpa.repository.JpaRepository

// The machine_id is a stable business key (used in URLs, tokens, screen routing), so
// it is the primary key directly rather than a surrogate BaseEntity id. Machines are
// hard-deleted, so there is no soft-delete restriction.
@Entity
@Table(name = "machine")
class Machine(
    @Id @Column(name = "machine_id", length = 64) var machineId: String = "",
    @Column(nullable = false) var name: String = "",
    @Column(nullable = false, unique = true, length = 128) var token: String = "",
    @Column(name = "created_at", nullable = false)
    var createdAt: LocalDateTime = LocalDateTime.now(),
)

interface MachineRepository : JpaRepository<Machine, String> {
    fun findByToken(token: String): Optional<Machine>
}
