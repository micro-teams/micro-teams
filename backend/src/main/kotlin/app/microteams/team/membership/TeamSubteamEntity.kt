/*
 *  Description: Teams inside teams: one row says that team [childId] is inside team [parentId].
 *               Whoever can access the parent can access the child (TeamAccess). A team may be
 *               inside several parents; a cycle is refused where rows are written (TeamService).
 *
 *               TeamSubteam / TeamSubteamRepository — the row and its repository.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.team.membership

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Index
import jakarta.persistence.Table
import jakarta.persistence.UniqueConstraint
import org.rucca.cheese.common.persistent.BaseEntity
import org.rucca.cheese.common.persistent.IdType
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.transaction.annotation.Transactional

// Hard-deleted, like memberships: an edge either exists or does not.
@Entity
@Table(
    name = "team_subteam",
    uniqueConstraints = [UniqueConstraint(columnNames = ["parent_id", "child_id"])],
    indexes = [Index(columnList = "parent_id"), Index(columnList = "child_id")],
)
class TeamSubteam(
    @Column(name = "parent_id", nullable = false) var parentId: IdType? = null,
    @Column(name = "child_id", nullable = false) var childId: IdType? = null,
) : BaseEntity()

interface TeamSubteamRepository : JpaRepository<TeamSubteam, IdType> {
    fun findByParentIdIn(parentIds: Collection<IdType>): List<TeamSubteam>

    fun findByParentId(parentId: IdType): List<TeamSubteam>

    fun findByChildId(childId: IdType): List<TeamSubteam>

    fun existsByParentIdAndChildId(parentId: IdType, childId: IdType): Boolean

    @Modifying @Transactional fun deleteByParentIdAndChildId(parentId: IdType, childId: IdType)

    @Modifying @Transactional fun deleteByParentId(parentId: IdType)

    @Modifying @Transactional fun deleteByChildId(childId: IdType)
}
