/*
 *  Description: This file defines the BaseEntity class.
 *               Usually, all entities should inherit from this class.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package org.rucca.cheese.common.persistent

import jakarta.persistence.*
import java.time.LocalDateTime
import org.hibernate.annotations.CreationTimestamp
import org.hibernate.annotations.UpdateTimestamp

typealias IdType = Long

typealias IdGetter = () -> IdType

/*
 * A base entity that provides common fields for all entities,
 * and enables soft deletion.
 *
 * Provided fields:
 *   - id:        The primary key of the entity.
 *   - createdAt: The timestamp when the entity was created.
 *   - updatedAt: The timestamp when the entity was last updated.
 *   - deletedAt: The timestamp when the entity was deleted.
 *
 * Add the following line to your entities to implement soft deletion:
 *      @SQLRestriction("deleted_at IS NULL")
 * Unfortunately, adding this line to BaseEntity does not work.
 */
@MappedSuperclass
abstract class BaseEntity(
    // Default value for id, createdAt and updatedAt DO NOT have any effect.
    // They are only set to avoid compilation errors when deriving an entity from BaseEntity.
    @Column(nullable = false)
    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE)
    var id: IdType? = null,
    @Column(nullable = false) @CreationTimestamp val createdAt: LocalDateTime? = null,
    @Column(nullable = false) @UpdateTimestamp val updatedAt: LocalDateTime? = null,
    var deletedAt: LocalDateTime? = null, // nullable
)
