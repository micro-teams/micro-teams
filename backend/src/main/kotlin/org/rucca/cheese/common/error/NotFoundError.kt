/*
 *  Description: This file defines the NotFoundError class.
 *               It is a generic error thrown when a resource with a specific id is not found.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package org.rucca.cheese.common.error

import org.rucca.cheese.common.persistent.IdType
import org.springframework.http.HttpStatus

class NotFoundError(type: String, id: IdType) :
    BaseError(
        status = HttpStatus.NOT_FOUND,
        message = "$type with id $id was not found",
        data = mapOf("type" to type, "id" to id),
    )
