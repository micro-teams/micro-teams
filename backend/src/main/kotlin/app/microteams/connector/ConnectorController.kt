/*
 *  Description: Serves the CLI distribution — the one-line installer and the prebuilt binaries a
 *               fresh machine needs — at the *origin root* (not under the /mt edge prefix), because
 *               that is where the CLI's self-updater and install.sh look for them:
 *
 *                 GET /install.sh                              → the installer, with the connector
 *                     base / API base / ws override baked in from the request's own origin, so a
 *                     `curl -fsSL <origin>/install.sh | sh` resolves everything against <origin>
 *                     with nothing configured (matches MachineController's forwarded-header origin).
 *                 GET /connector/latest/{target}/{artifact}    → the `microteams` binary or static
 *                     `tmux` for one <os>-<arch>, streamed from application.connector-binaries-dir.
 *                     This is the endpoint cli/internal/update/update.go downloads from.
 *
 *               Public (@NoAuth) and hand-written (not an AgentApi operation) for the same reason as
 *               AgentAppletController: it serves shell/binary *assets*, not business DTOs, which
 *               OpenAPI cannot describe. The installer carries no secrets — enrollment still goes
 *               through the device flow — so serving it openly is safe.
 *
 *               The binary route is the sharp edge: `target` and `artifact` are validated against
 *               strict allowlists, so no attacker-controlled path segment ever reaches the
 *               filesystem (no traversal). Anything off the allowlist, or a not-yet-published file,
 *               is a 404.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.connector

import jakarta.servlet.http.HttpServletRequest
import java.nio.file.Files
import java.nio.file.Path
import org.rucca.cheese.auth.annotation.NoAuth
import org.springframework.beans.factory.annotation.Value
import org.springframework.core.io.FileSystemResource
import org.springframework.core.io.Resource
import org.springframework.http.HttpHeaders
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RestController

@RestController
class ConnectorController(
    // The origin the binaries hang off is never configured — it is derived from the request (below)
    // so it is correct behind any host/port/proxy. Only the API edge prefix and the binaries dir
    // are
    // configurable, and both have sane defaults for the compose deployment.
    @Value("\${application.connector-api-base-path:/mt}") private val apiBasePath: String,
    @Value("\${application.connector-ws-override:}") private val wsOverride: String,
    @Value("\${application.connector-binaries-dir:/app/connector}") private val binariesDir: String,
) {

    // The only shapes install.sh + update.go ever request — Go-style os-arch (amd64/arm64), NOT
    // uname-style (x86_64/aarch64); install.sh maps uname to these before asking. Keep in lockstep
    // with update.go's platformDir.
    private val targets = setOf("linux-amd64", "linux-arm64", "darwin-amd64", "darwin-arm64")
    // The only artifacts published per target. Keeps the served path off the filesystem's leash.
    private val artifacts = setOf("microteams", "tmux")

    @NoAuth
    @GetMapping("/install.sh", produces = ["text/x-shellscript"])
    fun installScript(request: HttpServletRequest): ResponseEntity<String> {
        val script =
            javaClass.getResourceAsStream("/install.sh")?.bufferedReader()?.use { it.readText() }
                ?: return ResponseEntity.notFound().build()
        val origin = origin(request)
        val baked =
            script
                .replace("__CONNECTOR_BASE__", origin)
                .replace("__API_BASE__", origin + apiBasePath)
                .replace("__WS_BASE__", wsOverride)
        return ResponseEntity.ok()
            .contentType(MediaType.parseMediaType("text/x-shellscript"))
            .body(baked)
    }

    @NoAuth
    @GetMapping("/connector/latest/{target}/{artifact}")
    fun artifact(
        @PathVariable target: String,
        @PathVariable artifact: String,
    ): ResponseEntity<Resource> {
        if (target !in targets) {
            throw ConnectorArtifactNotFoundError(
                "unknown target: $target (expected <os>-<arch>, e.g. linux-amd64)"
            )
        }
        if (artifact !in artifacts) {
            throw ConnectorArtifactNotFoundError(
                "unknown artifact: $artifact (expected one of ${artifacts.sorted()})"
            )
        }
        val base = Path.of(binariesDir).toAbsolutePath().normalize()
        val file = base.resolve(target).resolve(artifact).normalize()
        // Defense in depth: even though target/artifact are allowlisted (so no `..` is possible),
        // refuse anything that would resolve outside the configured root.
        if (!file.startsWith(base) || !Files.isRegularFile(file)) {
            throw ConnectorArtifactNotFoundError("no published $artifact for $target")
        }
        return ResponseEntity.ok()
            .contentType(MediaType.APPLICATION_OCTET_STREAM)
            .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"$artifact\"")
            .contentLength(Files.size(file))
            .body(FileSystemResource(file))
    }

    // Reuse the same forwarded-header origin the rest of the backend derives (see
    // MachineController.origin): we sit behind nginx, which sets X-Forwarded-Proto/Host; fall back
    // to
    // the request's own when they are absent. No domain is ever baked in.
    private fun origin(request: HttpServletRequest): String {
        val proto = request.getHeader("X-Forwarded-Proto") ?: request.scheme
        val host = request.getHeader("X-Forwarded-Host") ?: request.getHeader("Host")
        return "$proto://$host"
    }
}
