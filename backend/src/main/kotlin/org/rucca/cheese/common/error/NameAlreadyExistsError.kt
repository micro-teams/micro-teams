/*
 *  Description: This file defines the NameAlreadyExistsError class.
 *               It is a generic error thrown when a resource with the same name already exists.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package org.rucca.cheese.common.error

import org.springframework.http.HttpStatus

class NameAlreadyExistsError(type: String, name: String) :
    BaseError(
        status = HttpStatus.CONFLICT,
        message = "$type with name $name already exists",
        data = mapOf("type" to type, "name" to name),
    )
