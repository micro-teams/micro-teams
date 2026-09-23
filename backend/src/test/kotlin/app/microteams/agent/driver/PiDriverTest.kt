/*
 *  Description: Unit-ish test for the Pi driver (a real object, nothing mocked — like
 *               CodexDriverTest). Pins the pi-specific choices: a single `--session-id` that covers
 *               BOTH fresh launch and resume (pi creates the session when the id is new and resumes
 *               it when it exists, so the driver never has to say which it meant), the operator
 *               prompt riding in `--append-system-prompt` (the same channel Claude uses), and the
 *               applet resolving to the bundled pi.js.
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

class PiDriverTest {
    // Empty applets-dir -> AppletStore reads the classpath fallback (src/test/resources/applets).
    private val driver = PiDriver(AppletStore(""))

    @Test
    fun driverIsNamedPi() {
        assertEquals("pi", driver.name)
    }

    @Test
    fun freshLaunchRunsPiWithASessionIdAndTheOperatorPrompt() {
        val cmd = driver.command("sess-123", "~/work/repo", resume = false)
        assertEquals(listOf("bash", "-lc"), cmd.dropLast(1))
        val inner = cmd.last()
        // A single --session-id names the session; pi creates it on first use.
        assertTrue(inner.contains("exec pi --session-id sess-123"), inner)
        // No separate resume verb — pi's --session-id already covers "continue this one".
        assertFalse(inner.contains("--resume"), inner)
        // The standing operator instructions ride in --append-system-prompt, as they do for Claude.
        assertTrue(inner.contains("--append-system-prompt"), inner)
        assertTrue(inner.contains("microteams api say"), inner)
        // Enters the workspace (created first; a leading ~ is expanded on the machine). pi scopes
        // its sessions by this cwd, so the enter is what makes a later resume find the same
        // session.
        assertTrue(inner.contains("_mtcwd='~/work/repo'"), inner)
        assertTrue(inner.contains("cd \"\$_mtcwd\""), inner)
    }

    @Test
    fun resumeUsesTheSameSessionIdNotASecondFlag() {
        val fresh = driver.command("sess-123", null, resume = false).last()
        val resumed = driver.command("sess-123", null, resume = true).last()
        assertEquals(
            fresh,
            resumed,
            "pi needs no separate resume path: --session-id resumes when it exists",
        )
    }

    @Test
    fun appletSourceIsTheBundledPiApplet() {
        val src = driver.appletSource
        assertTrue(src.contains("screenReady"), "should be the real bundled screen applet")
        // pi carries its operator prompt on the command line, so the applet holds no placeholder.
        assertFalse(src.contains("__MT_OPERATOR_PROMPT__"), "prompt rides in argv, not the applet")
    }
}
