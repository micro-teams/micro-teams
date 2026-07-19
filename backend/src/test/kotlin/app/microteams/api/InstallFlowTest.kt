/*
 *  Description: Integration test for the CLI distribution flow — the install.sh served at the origin
 *               root and the prebuilt-binary route the CLI's self-updater downloads from. Drives both
 *               through the full stack with real MockMvc. Asserts install.sh bakes the request's own
 *               origin (and leaves no placeholder behind), that a real binary streams byte-for-byte
 *               from the configured dir, and — the sharp edge — that an off-allowlist target/artifact
 *               or a not-yet-published file is a 404, never a filesystem oracle.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.api

import java.nio.file.Files
import java.nio.file.Path
import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.*

@SpringBootTest
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@AutoConfigureMockMvc
class InstallFlowTest @Autowired constructor(private val mockMvc: MockMvc) {

    companion object {
        // A fresh, hermetic dir per run — the connector binaries the route serves live here, so no
        // published artifact is needed to run the test (we drop a fixture in @BeforeAll).
        private val binDir: Path = Files.createTempDirectory("connector-binaries-test")

        @JvmStatic
        @DynamicPropertySource
        fun props(registry: DynamicPropertyRegistry) {
            registry.add("application.connector-binaries-dir") { binDir.toString() }
        }
    }

    // Known bytes so we can prove the route streams the file as-is (a real binary is opaque; this
    // stands in for one).
    private val fixture = "#!/bin/sh\necho microteams fixture binary\n".toByteArray()

    @BeforeAll
    fun publishFixture() {
        val target = binDir.resolve("linux-amd64")
        Files.createDirectories(target)
        Files.write(target.resolve("microteams"), fixture)
    }

    @Test
    fun `install_sh bakes the request origin and leaves no placeholder`() {
        val body =
            mockMvc
                .perform(
                    get("/install.sh")
                        .header("X-Forwarded-Proto", "https")
                        .header("X-Forwarded-Host", "teams.example.test")
                )
                .andExpect(status().isOk)
                .andExpect(content().contentTypeCompatibleWith("text/x-shellscript"))
                .andReturn()
                .response
                .contentAsString

        assertTrue(body.contains("microteams"), "installer should mention the binary name")
        // Binaries hang off the origin root; the cli's API base is <origin>/mt.
        assertTrue(
            body.contains("https://teams.example.test"),
            "installer should bake the request's origin",
        )
        assertTrue(
            body.contains("https://teams.example.test/mt"),
            "installer should bake the API base (<origin>/mt)",
        )
        // No un-substituted placeholder may ever reach a client.
        assertFalse(body.contains("__CONNECTOR_BASE__"), "connector base placeholder not replaced")
        assertFalse(body.contains("__API_BASE__"), "API base placeholder not replaced")
        assertFalse(body.contains("__WS_BASE__"), "ws base placeholder not replaced")
    }

    @Test
    fun `binary route streams the published file as-is`() {
        val bytes =
            mockMvc
                .perform(get("/connector/latest/linux-amd64/microteams"))
                .andExpect(status().isOk)
                .andExpect(content().contentType("application/octet-stream"))
                .andReturn()
                .response
                .contentAsByteArray

        assertArrayEquals(fixture, bytes, "served bytes must match the published file exactly")
    }

    @Test
    fun `unknown target is 404`() {
        mockMvc
            .perform(get("/connector/latest/windows-amd64/microteams"))
            .andExpect(status().isNotFound)
    }

    @Test
    fun `dotted target segment never reaches disk`() {
        // A would-be traversal segment never matches the allowlist, so it is rejected before
        // touching disk — a 404 (an encoded-slash variant may be refused even earlier, hence 4xx).
        mockMvc.perform(get("/connector/latest/x..x/microteams")).andExpect(status().isNotFound)
        mockMvc
            .perform(get("/connector/latest/..%2F..%2Fetc/microteams"))
            .andExpect(status().is4xxClientError)
    }

    @Test
    fun `unknown artifact is 404`() {
        mockMvc.perform(get("/connector/latest/linux-amd64/passwd")).andExpect(status().isNotFound)
    }

    @Test
    fun `allowlisted target with no published file is 404`() {
        // Valid target + valid artifact, but nothing published for it — a 404, not a 500 or an
        // oracle.
        mockMvc.perform(get("/connector/latest/darwin-arm64/tmux")).andExpect(status().isNotFound)
    }
}
