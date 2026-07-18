/*
 *  Description: This file defines the TokenExpiredError class.
 *               It is thrown when the token has expired.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package org.rucca.cheese.auth.error

import org.rucca.cheese.common.error.BaseError
import org.springframework.http.HttpStatus

class TokenExpiredError : BaseError(HttpStatus.UNAUTHORIZED, "Token has expired")
