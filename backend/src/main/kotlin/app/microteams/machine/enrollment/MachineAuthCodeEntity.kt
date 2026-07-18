/*
 *  Description: This file defines the MachineAuthCode entity and its repository. It
 *               backs the machine enrollment flow: `start` mints a pending code the
 *               client polls on; a logged-in human `approve`s it (choosing the team
 *               to bind the machine to); `poll` then hands the durable token back.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.machine.enrollment

import jakarta.persistence.*
import java.time.LocalDateTime
import java.util.Optional
import org.rucca.cheese.common.persistent.IdType
import org.springframework.data.jpa.repository.JpaRepository

object MachineCodeStatus {
    const val PENDING = "pending"
    const val APPROVED = "approved"
}

@Entity
@Table(name = "machine_auth_code")
class MachineAuthCode(
    @Id @Column(length = 64) var code: String = "",
    @Column(name = "machine_name", nullable = false) var machineName: String = "",
    @Column(nullable = false, length = 16) var status: String = MachineCodeStatus.PENDING,
    @Column(name = "machine_id", length = 64) var machineId: String? = null,
    // The team the approver bound the machine to (set at approval).
    @Column(name = "team_id") var teamId: IdType? = null,
    @Column(name = "created_at", nullable = false)
    var createdAt: LocalDateTime = LocalDateTime.now(),
)

interface MachineAuthCodeRepository : JpaRepository<MachineAuthCode, String> {
    fun findByCode(code: String): Optional<MachineAuthCode>
}
