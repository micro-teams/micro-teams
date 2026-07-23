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
     *
     * The standing operator instructions ride in `--append-system-prompt`: injected once here at
     * launch, they apply for the whole session and *append to* (never replace) whatever CLAUDE.md
     * the working repo carries — which matters when the cwd is a real code checkout with its own.
     * That is why each group message we later type is just the message, not a repeated how-to.
     */
    override fun command(sessionId: String, cwd: String?, resume: Boolean): List<String> {
        val flag = if (resume) "--resume" else "--session-id"
        // An autonomous agent can't answer prompts, so run Claude non-interactively: pre-mark
        // first-run onboarding (so a fresh machine doesn't hang on the welcome/trust screens) and
        // skip the permission gates. But Claude REFUSES --dangerously-skip-permissions under
        // root/sudo, so add that flag only when the connector runs as a non-root user (the intended
        // setup — install.sh + the boot service run as the enrolling user). Under root we omit it
        // so
        // Claude still starts and falls back to the applet's auto-accept, rather than exiting.
        val onboard =
            "mkdir -p \"\$HOME/.claude\"; [ -f \"\$HOME/.claude.json\" ] || " +
                "printf '{\"hasCompletedOnboarding\":true}' > \"\$HOME/.claude.json\""
        val skipIfNonRoot = "\$([ \"\$(id -u)\" != 0 ] && printf %s --dangerously-skip-permissions)"
        var inner =
            "$onboard; exec claude $flag $sessionId $skipIfNonRoot " +
                "--append-system-prompt ${shellQuote(OperatorPrompt.TEXT)}"
        // The cwd is the agent's document-tree workspace; enterCwd creates it (it may not exist yet
        // on a fresh machine — the applet's `docs sync` clones into it) and supports a leading `~`.
        if (cwd != null) inner = enterCwd(cwd) + inner
        return listOf("bash", "-lc", inner)
    }
}
