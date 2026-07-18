/*
 *  Description: This file defines the BadRequestError class.
 *               It is thrown when a request is invalid.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package org.rucca.cheese.common.error

import org.springframework.http.HttpStatus

class BadRequestError(message: String) : BaseError(HttpStatus.BAD_REQUEST, message)
