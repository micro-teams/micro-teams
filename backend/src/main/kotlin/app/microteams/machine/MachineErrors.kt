/*
 *  Description: Error types for the connector module. They extend BaseError so the
 *               global handler maps them to the right HTTP status (a plain exception
 *               would become a 500).
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.machine

import org.rucca.cheese.common.error.BaseError
import org.springframework.http.HttpStatus

class ForbiddenError(message: String) : BaseError(HttpStatus.FORBIDDEN, message)

class MachineNotFoundError(machineId: String) :
    BaseError(
        HttpStatus.NOT_FOUND,
        "machine not found: $machineId",
        mapOf("machineId" to machineId),
    )

class MachineCodeNotFoundError : BaseError(HttpStatus.NOT_FOUND, "unknown or expired machine code")
