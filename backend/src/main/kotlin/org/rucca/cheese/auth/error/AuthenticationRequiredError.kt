/*
 *  Description: This file defines the AuthenticationRequiredError class.
 *               It is thrown when no authentication is provided when it is required.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package org.rucca.cheese.auth.error

import org.rucca.cheese.common.error.BaseError
import org.springframework.http.HttpStatus

class AuthenticationRequiredError :
    BaseError(HttpStatus.UNAUTHORIZED, "Authentication is required to access this resource")
