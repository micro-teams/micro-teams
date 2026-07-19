/*
 *  Description: Error types for the connector distribution endpoints. They extend BaseError so the
 *               global handler maps them to the right HTTP status (a plain exception would become a
 *               500). A request for an unknown target/artifact, or a not-yet-published binary, is a
 *               404 — the same "no existence oracle" shape the rest of the backend uses.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.connector

import org.rucca.cheese.common.error.BaseError
import org.springframework.http.HttpStatus

class ConnectorArtifactNotFoundError(message: String) : BaseError(HttpStatus.NOT_FOUND, message)
