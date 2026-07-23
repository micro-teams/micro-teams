/*
 *  Description: Unit-ish test for the Codex driver (a real object, nothing mocked — like
 *               GitServiceTest). Pins the two Codex-specific choices: full-auto argv + operator
 *               prompt as the initial session prompt on a fresh launch, `resume --last` without
 *               re-injecting on reboot; and that its applet resolves to the bundled codex.js.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.agent.driver

import app.microteams.agent.AppletStore
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class CodexDriverTest {
    // Empty applets-dir -> AppletStore reads the classpath fallback (src/test/resources/applets).
    private val driver = CodexDriver(AppletStore(""))

    @Test
    fun driverIsNamedCodex() {
        assertEquals("codex", driver.name)
    }

    @Test
    fun freshLaunchRunsCodexFullAutoWithTheOperatorPromptInTheCwd() {
        val cmd = driver.command("sess-123", "microteams-docs/team-7", resume = false)
        assertEquals(listOf("bash", "-lc"), cmd.dropLast(1))
        val inner = cmd.last()
        // full-auto: Codex's YOLO equivalent of Claude's --dangerously-skip-permissions.
        assertTrue(inner.contains("-c approval_policy=never"), inner)
        assertTrue(inner.contains("-c sandbox_mode=danger-full-access"), inner)
        // launches codex (not resume) and injects the standing instructions as the initial prompt.
        assertTrue(inner.contains("exec codex -c "), inner)
        assertFalse(inner.contains("resume"), inner)
        assertTrue(inner.contains("microteams api say"), inner) // a fragment of OperatorPrompt.TEXT
        // enters the workspace, creating it first (may not exist yet on a fresh machine).
        assertTrue(inner.contains("mkdir -p 'microteams-docs/team-7'"), inner)
        assertTrue(inner.contains("cd 'microteams-docs/team-7'"), inner)
    }

    @Test
    fun resumeContinuesTheLastSessionWithoutReinjectingInstructions() {
        val inner = driver.command("sess-123", "microteams-docs/team-7", resume = true).last()
        assertTrue(inner.contains("exec codex resume --last"), inner)
        assertTrue(inner.contains("-c approval_policy=never"), inner)
        // The standing instructions are already in the resumed session's history.
        assertFalse(inner.contains("microteams api say"), inner)
    }

    @Test
    fun appletSourceResolvesToTheBundledCodexApplet() {
        val src = driver.appletSource
        assertTrue(src.contains("screenReady"), "should be the real bundled screen applet")
        assertTrue(src.contains("codex"), "the codex applet reports driver 'codex'")
    }
}
