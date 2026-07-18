/*
 *  Description: The Claude Code driver — the only place in the backend that knows Claude exists.
 *               Its applet is resources/applets/claude.js.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.agent.driver

import org.springframework.core.io.ClassPathResource
import org.springframework.stereotype.Component

@Component
class ClaudeDriver : AgentDriver {
    override val name = "claude"

    override val appletSource: String by lazy {
        ClassPathResource("applets/claude.js").inputStream.bufferedReader().use { it.readText() }
    }

    /**
     * We always control Claude's session id (`--session-id` fresh / `--resume` to continue), and
     * prepend the cwd because Claude resolves a session's transcript by the cwd's slug — resuming
     * from elsewhere silently starts a blank session.
     */
    override fun command(sessionId: String, cwd: String?, resume: Boolean): List<String> {
        val flag = if (resume) "--resume" else "--session-id"
        var inner = "exec claude $flag $sessionId"
        if (cwd != null) inner = "cd ${shellQuote(cwd)} && $inner"
        return listOf("bash", "-lc", inner)
    }

    private fun shellQuote(s: String): String = "'" + s.replace("'", "'\\''") + "'"
}
