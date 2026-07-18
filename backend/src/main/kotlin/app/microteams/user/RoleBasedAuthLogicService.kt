/*
 *  Description: This file implements the RoleBasedAuthLogicService class.
 *               It provides the logic for role-based authorization.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.user

import javax.annotation.PostConstruct
import org.rucca.cheese.auth.AuthorizationService
import org.rucca.cheese.auth.AuthorizedAction
import org.rucca.cheese.auth.error.PermissionDeniedError
import org.rucca.cheese.common.persistent.IdGetter
import org.rucca.cheese.common.persistent.IdType
import org.springframework.stereotype.Service

@Service
class RoleBasedAuthLogicService(
    private val authorizationService: AuthorizationService,
    private val rolePermissionService: RolePermissionService,
) {
    @PostConstruct
    fun initialize() {
        authorizationService.customAuthLogics.register("role-based") {
            userId: IdType,
            action: AuthorizedAction,
            resourceType: String,
            resourceId: IdType?,
            authInfo: Map<String, Any>,
            resourceOwnerIdGetter: IdGetter?,
            customLogicData: Any? ->
            audit(
                userId,
                action,
                resourceType,
                resourceId,
                authInfo,
                resourceOwnerIdGetter,
                customLogicData,
            )
        }
    }

    fun audit(
        userId: IdType,
        action: AuthorizedAction,
        resourceType: String,
        resourceId: IdType?,
        authInfo: Map<String, Any>,
        resourceOwnerIdGetter: IdGetter?,
        customLogicData: Any?,
    ): Boolean {
        val role =
            (customLogicData as? Map<*, *>)?.get("role") as? String
                ?: throw RuntimeException(
                    "Role not found in customLogicData. This is ether a bug or a malicious attack."
                )
        val authorization = rolePermissionService.getAuthorizationForUserWithRole(userId, role)
        try {
            authorizationService.audit(authorization, action, resourceType, resourceId, authInfo)
            return true
        } catch (e: PermissionDeniedError) {
            return false
        }
    }
}
