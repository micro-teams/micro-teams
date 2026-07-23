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
        val cmd = driver.command("sess-123", "~/work/repo", resume = false)
        assertEquals(listOf("bash", "-lc"), cmd.dropLast(1))
        val inner = cmd.last()
        // full-auto: skip approvals AND the sandbox entirely (peer of Claude's skip-permissions).
        assertTrue(inner.contains("exec codex --dangerously-bypass-approvals-and-sandbox"), inner)
        // launches codex (not resume) and injects the standing instructions as the initial prompt.
        assertFalse(inner.contains("resume"), inner)
        assertTrue(inner.contains("microteams api say"), inner) // a fragment of OperatorPrompt.TEXT
        // enters the workspace (created first; a leading ~ is expanded on the machine).
        assertTrue(inner.contains("_mtcwd='~/work/repo'"), inner)
        assertTrue(inner.contains("cd \"\$_mtcwd\""), inner)
    }

    @Test
    fun resumeContinuesTheLastSessionWithoutReinjectingInstructions() {
        val inner = driver.command("sess-123", "~/work/repo", resume = true).last()
        assertTrue(
            inner.contains("exec codex --dangerously-bypass-approvals-and-sandbox resume --last"),
            inner,
        )
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
