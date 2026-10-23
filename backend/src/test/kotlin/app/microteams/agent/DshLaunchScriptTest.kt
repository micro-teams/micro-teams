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
    private lateinit var dshPath: String

    /**
     * A stand-in `dsh` that answers --version with [version], at MICROTEAMS_DSH so the lookup is
     * deterministic whatever the host has installed.
     */
    private fun standInDsh(bin: File, version: String): String =
        File(bin, "dsh")
            .apply {
                val answer = File(bin, "dsh.version").apply { writeText(version + "\n") }
                writeText("#!/bin/bash\n[ \"\$1\" = --version ] && cat '${answer.path}'\n")
                setExecutable(true)
            }
            .path

    private fun launch(
        env: Map<String, String>,
        dshVersion: String = "0.2.1-rc.2",
    ): Triple<List<String>, Map<String, String>, File> {
        val (code, log, result) = run(env, dshVersion)
        assertEquals(0, code, "launch failed: $log")
        return result!!
    }

    private fun run(
        env: Map<String, String>,
        dshVersion: String,
    ): Triple<Int, String, Triple<List<String>, Map<String, String>, File>?> {
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
        dshPath = standInDsh(bin, dshVersion)
        val state = File(tmp, "state")
        val pb = ProcessBuilder(driver.command("sess-1", File(tmp, "work").path, resume = false))
        pb.environment().apply {
            put("HOME", tmp.path)
            put("XDG_STATE_HOME", state.path)
            put("MICROTEAMS_DSH", dshPath)
            listOf("DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL").forEach { remove(it) }
            putAll(env)
        }
        val p = pb.redirectErrorStream(true).start()
        val log = p.inputStream.bufferedReader().readText()
        val code = p.waitFor()
        if (code != 0) return Triple(code, log, null)
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
        return Triple(0, log, Triple(argv, dumped, state))
    }

    @Test
    fun withNoSettingDshUsesTheMachinesOwnConfiguration() {
        val (argv, env, _) = launch(emptyMap())
        assertEquals(
            listOf("acp-screen", "--session", "sess-1", "--", dshPath, "--profile", "acp"),
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
                dshPath,
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

    /** A different program called dsh (Debian/Arch "Distributed Shell") is named, not run. */
    @Test
    fun anUnrelatedDshIsRefusedWithAMessage() {
        val (code, log, _) = run(emptyMap(), "Distributed Shell / Dancer's shell version 0.25.10")
        assertEquals(127, code)
        assertTrue(log.contains("is a different program"), log)
        assertTrue(log.contains("npm i -g @deepseek-ai/dsh"), log)
    }
}
