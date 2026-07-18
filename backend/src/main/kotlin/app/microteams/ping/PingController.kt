/*
 *  Description: Minimal authenticated example endpoint, kept from the stripped
 *               skeleton so the frontend has something real to verify the
 *               frontend -> mt -> JWT chain against (see design/API/NT-API.yml).
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.ping

import app.microteams.api.PingApi
import app.microteams.model.Ping200ResponseDTO
import org.rucca.cheese.auth.AuthenticationService
import org.rucca.cheese.auth.annotation.Guard
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.RestController

@RestController
class PingController(private val authenticationService: AuthenticationService) : PingApi {
    @Guard("query", "ping")
    override fun ping(): ResponseEntity<Ping200ResponseDTO> {
        val userId = authenticationService.getCurrentUserId()
        return ResponseEntity.ok(Ping200ResponseDTO(code = 200, message = "pong from user $userId"))
    }
}
