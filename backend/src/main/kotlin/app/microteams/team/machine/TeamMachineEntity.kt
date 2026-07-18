/*
 *  Description: This file defines the TeamMachine association and its repository. It
 *               binds a machine to a team. The model is deliberately symmetric and
 *               owner-less: a machine may be associated with many teams, and every
 *               member of any associated team has full, equal rights over the machine
 *               (delete it, share it to more teams, or remove any team's association).
 *               Associations are hard-deleted, so there is no @SQLRestriction.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.team.machine

import jakarta.persistence.*
import java.util.Optional
import org.rucca.cheese.common.persistent.BaseEntity
import org.rucca.cheese.common.persistent.IdType
import org.springframework.data.jpa.repository.JpaRepository

@Entity
@Table(
    name = "team_machine",
    uniqueConstraints =
        [UniqueConstraint(name = "uq_team_machine", columnNames = ["machine_id", "team_id"])],
    indexes = [Index(columnList = "machine_id"), Index(columnList = "team_id")],
)
class TeamMachine(
    @Column(name = "machine_id", nullable = false, length = 64) var machineId: String? = null,
    @Column(name = "team_id", nullable = false) var teamId: IdType? = null,
) : BaseEntity()

interface TeamMachineRepository : JpaRepository<TeamMachine, IdType> {
    fun findByMachineId(machineId: String): List<TeamMachine>

    fun findByTeamId(teamId: IdType): List<TeamMachine>

    fun findByMachineIdAndTeamId(machineId: String, teamId: IdType): Optional<TeamMachine>

    fun existsByMachineIdAndTeamId(machineId: String, teamId: IdType): Boolean

    fun deleteByMachineIdAndTeamId(machineId: String, teamId: IdType)

    fun deleteByMachineId(machineId: String)
}
