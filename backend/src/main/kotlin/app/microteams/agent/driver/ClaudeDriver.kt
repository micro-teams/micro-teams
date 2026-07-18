/*
 *  Description: The Claude Code driver — the only place in the backend that knows Claude exists.
 *               Its applet (claude.js) comes from the AppletStore (mounted applets-dir, or the
 *               classpath fallback).
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.agent.driver

import app.microteams.agent.AppletStore
import org.springframework.stereotype.Component

@Component
class ClaudeDriver(private val appletStore: AppletStore) : AgentDriver {
    override val name = "claude"

    override val appletSource: String by lazy { appletStore.require("claude.js") }

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
