/*
 *  Description: This file defines the Team entity and its repository.
 *               A team owns a git repository of documents and has members.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.team.membership

import jakarta.persistence.*
import org.hibernate.annotations.SQLRestriction
import org.rucca.cheese.common.persistent.BaseEntity
import org.rucca.cheese.common.persistent.IdType
import org.springframework.data.jpa.repository.JpaRepository

@Entity
@SQLRestriction("deleted_at IS NULL")
@Table(name = "team", indexes = [Index(columnList = "name")])
class Team(@Column(nullable = false) var name: String? = null) : BaseEntity()

interface TeamRepository : JpaRepository<Team, IdType>
