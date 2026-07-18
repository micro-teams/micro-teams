/*
 *  Description: This file defines the JWT token payload,
 *               which is compatible with the legacy service.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package org.rucca.cheese.auth

import org.rucca.cheese.common.persistent.IdType

typealias AuthorizedAction = String

data class AuthorizedResource(
    val ownedByUser: IdType? = null,
    val types: List<String>? = null,
    val resourceIds: List<IdType>? = null,
    val data: Any? = null,
)

data class Permission(
    val authorizedActions: List<AuthorizedAction>? = null,
    val authorizedResource: AuthorizedResource,
    val customLogic: String? = null,
    val customLogicData: Any? = null,
)

data class Authorization(val userId: IdType, val permissions: List<Permission>)

data class TokenPayload(val authorization: Authorization, val signedAt: Long, val validUntil: Long)
