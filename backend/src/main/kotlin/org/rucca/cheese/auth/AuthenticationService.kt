/*
 *  Description: This file implements the AuthenticationService class.
 *               It is responsible for providing the current user's authentication information.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package org.rucca.cheese.auth

import org.rucca.cheese.auth.error.AuthenticationRequiredError
import org.rucca.cheese.common.persistent.IdType
import org.springframework.stereotype.Service
import org.springframework.web.context.request.RequestContextHolder
import org.springframework.web.context.request.ServletRequestAttributes

@Service
class AuthenticationService(private val authorizationService: AuthorizationService) {
    fun getToken(): String {
        return (RequestContextHolder.currentRequestAttributes() as ServletRequestAttributes)
            .request
            .getHeader("Authorization") ?: throw AuthenticationRequiredError()
    }

    fun getCurrentUserId(): IdType {
        val token = getToken()
        val authorization = authorizationService.verify(token)
        return authorization.userId
    }
}
