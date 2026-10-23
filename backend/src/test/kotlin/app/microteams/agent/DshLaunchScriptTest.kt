/*
 *  Description: The dsh driver's launch script, run for real by bash with a stand-in `microteams` on
 *               PATH that records the argv and environment it was exec'd with. This is the contract
 *               with dsh that matters and that no other test can see: which environment variables
 *               dsh is started with for a DeepSeek key, what overlay file a custom endpoint turns
 *               into (and that the key is NOT in it), and that a value cannot break that file.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.agent

import app.microteams.agent.driver.DshDriver
import java.io.File
import java.nio.file.Files
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class DshLaunchScriptTest {
    private val driver = DshDriver(AppletStore(""))

    /**
     * Run the driver's command with [env]; returns (argv after `acp-screen`, env dump, state dir).
     */
    private fun launch(env: Map<String, String>): Triple<List<String>, Map<String, String>, File> {
        val tmp = Files.createTempDirectory("dsh-launch").toFile()
        val bin = File(tmp, "bin").apply { mkdirs() }
        val out = File(tmp, "out")
        File(bin, "microteams").apply {
            writeText(
                "#!/bin/bash\nprintf '%s\\n' \"\$@\" > '${out.path}.argv'\n" +
                    "env > '${out.path}.env'\n",
            )
            setExecutable(true)
        }
        // The command is `bash -lc`, and a login shell rebuilds PATH from the profile — the way the
        // real `microteams` (in ~/.local/bin) is found on a machine. So the stand-in goes on PATH
        // the
        // same way: through this HOME's profile.
        File(tmp, ".bash_profile").writeText("export PATH='${bin.path}':\"\$PATH\"\n")
        val state = File(tmp, "state")
        val pb = ProcessBuilder(driver.command("sess-1", File(tmp, "work").path, resume = false))
        pb.environment().apply {
            put("HOME", tmp.path)
            put("XDG_STATE_HOME", state.path)
            listOf("DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL").forEach { remove(it) }
            putAll(env)
        }
        val p = pb.redirectErrorStream(true).start()
        val log = p.inputStream.bufferedReader().readText()
        assertEquals(0, p.waitFor(), "launch failed: $log")
        val argv = File("${out.path}.argv").readLines()
        val dumped =
            File("${out.path}.env")
                .readLines()
                .mapNotNull { line ->
                    line
                        .indexOf('=')
                        .takeIf { it > 0 }
                        ?.let { line.substring(0, it) to line.substring(it + 1) }
                }
                .toMap()
        return Triple(argv, dumped, state)
    }

    @Test
    fun withNoSettingDshUsesTheMachinesOwnConfiguration() {
        val (argv, env, _) = launch(emptyMap())
        assertEquals(
            listOf("acp-screen", "--session", "sess-1", "--", "dsh", "--profile", "acp"),
            argv,
        )
        assertFalse(env.containsKey("DEEPSEEK_API_KEY"))
        // `env` prints one variable per line, so only the prompt's first line is in the dump.
        assertTrue(env["MICROTEAMS_OPERATOR_PROMPT"]!!.startsWith("You are an autonomous agent"))
    }

    @Test
    fun aDeepSeekKeyAndEndpointBecomeDshsOwnVariables() {
        val (argv, env, _) =
            launch(
                mapOf(
                    "MICROTEAMS_LLM_PROVIDER" to "deepseek",
                    "MICROTEAMS_LLM_API_KEY" to "sk-abc",
                    "MICROTEAMS_LLM_BASE_URL" to "https://ds.example",
                    "MICROTEAMS_LLM_MODEL" to "deepseek-v4-pro",
                ),
            )
        assertEquals("sk-abc", env["DEEPSEEK_API_KEY"])
        assertEquals("https://ds.example", env["DEEPSEEK_BASE_URL"])
        assertEquals(
            listOf(
                "acp-screen",
                "--session",
                "sess-1",
                "--model",
                "deepseek-v4-pro",
                "--",
                "dsh",
                "--profile",
                "acp",
            ),
            argv,
        )
    }

    @Test
    fun aCustomEndpointBecomesAnOverlayWithoutTheKeyInIt() {
        val (argv, env, state) =
            launch(
                mapOf(
                    "MICROTEAMS_LLM_PROVIDER" to "custom",
                    "MICROTEAMS_LLM_API" to "openai-completions",
                    "MICROTEAMS_LLM_BASE_URL" to "https://gw.example/v1",
                    // A value that would break naive YAML: quotes, a backslash, a colon.
                    "MICROTEAMS_LLM_MODEL" to "we\"ird\\model: x",
                    "MICROTEAMS_LLM_API_KEY" to "sk-secret-123",
                ),
            )
        val patch = File(state, "microteams/acp/sess-1.dsh-patch.yml")
        assertEquals(
            listOf("--patch", patch.path),
            argv.subList(argv.indexOf("acp") + 1, argv.size),
        )
        val yaml = patch.readText()
        assertTrue(yaml.contains("apiKeyEnv: MICROTEAMS_LLM_API_KEY"), yaml)
        assertTrue(yaml.contains("api: \"openai-completions\""), yaml)
        assertTrue(yaml.contains("baseURL: \"https://gw.example/v1\""), yaml)
        assertTrue(yaml.contains("- id: \"we\\\"ird\\\\model: x\""), yaml)
        assertFalse(yaml.contains("sk-secret-123"), "the key was written into the overlay")
        assertEquals("sk-secret-123", env["MICROTEAMS_LLM_API_KEY"])
        assertFalse(env.containsKey("DEEPSEEK_API_KEY"))
    }
}
