/*
 *  Description: Serves the CLI applet — the JavaScript that defines the `microteams api` command
 *               tree — at GET /agent/cli-applet. The CLI fetches it on demand (caching it) and runs
 *               it in an embedded goja VM, so the command surface an agent uses is server-authored
 *               and can evolve without shipping a new binary. This replaces the old /openapi.json
 *               document that fed Restish's per-operation command generation, which an agent found
 *               hard to navigate.
 *
 *               Public (@NoAuth): the CLI fetches the applet before it has a token, and the applet
 *               authenticates its own calls afterwards. Hand-written (not an AgentApi operation)
 *               because it serves a JavaScript asset, not a business DTO — the same reason its
 *               predecessor was. The bytes come from the classpath resource applets/cli.js, which
 *               the applets module's build copies in.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.agent

import org.rucca.cheese.auth.annotation.NoAuth
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController

@RestController
class AgentAppletController(private val appletStore: AppletStore) {

    @NoAuth
    @GetMapping("/agent/cli-applet", produces = ["text/javascript"])
    fun cliApplet(): ResponseEntity<String> {
        val js =
            appletStore.read("cli.js") ?: return ResponseEntity.status(HttpStatus.NOT_FOUND).build()
        return ResponseEntity.ok().contentType(MediaType.parseMediaType("text/javascript")).body(js)
    }
}
