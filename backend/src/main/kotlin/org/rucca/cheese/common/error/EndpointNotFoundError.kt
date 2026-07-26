/*
 *  Description: This file defines the EndpointNotFoundError class.
 *               It is returned when a request does not match any route (no
 *               controller mapping and no static resource) — a 404 for the URL
 *               itself, as opposed to NotFoundError which is a 404 for a
 *               resource id that a matched handler looked up and could not find.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package org.rucca.cheese.common.error

import org.springframework.http.HttpStatus

class EndpointNotFoundError(method: String, path: String) :
    BaseError(
        status = HttpStatus.NOT_FOUND,
        message = "No endpoint $method $path",
        data = mapOf("method" to method, "path" to path),
    )
