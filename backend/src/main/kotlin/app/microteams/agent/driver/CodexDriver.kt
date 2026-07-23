/*
 *  Description: The OpenAI Codex driver — peer of ClaudeDriver, the only other place that knows a
 *               specific agent program exists. Like ClaudeDriver it is exactly two things: the argv
 *               that launches/resumes a Codex session, and the applet (codex.js) that reads its
 *               terminal. Which model Codex talks to is the machine operator's concern
 *               (~/.codex/config.toml), exactly as Claude's auth is — the backend stays model-agnostic.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.agent.driver

import app.microteams.agent.AppletStore
import org.springframework.stereotype.Component

@Component
class CodexDriver(private val appletStore: AppletStore) : AgentDriver {
    override val name = "codex"

    override val appletSource: String by lazy { appletStore.require("codex.js") }

    /**
     * Launch (or resume) one Codex session. Two Codex-specific choices vs Claude:
     * 1. **Autonomy.** Codex has no `--dangerously-skip-permissions`; the equivalent is running
     *    with `approval_policy=never` + `sandbox_mode=danger-full-access` (its "YOLO" mode), passed
     *    as `-c` config overrides so we never depend on the operator's config for how *we* run it.
     * 2. **Standing instructions & sessions.** Codex has no `--append-system-prompt`, and it mints
     *    its own session ids (we cannot hand it one the way `claude --session-id` accepts). So on a
     *    fresh launch we inject [OperatorPrompt] as the initial prompt — Codex auto-runs it as turn
     *    one and keeps it in the session context — and on resume we continue the most recent
     *    session for this cwd (`resume --last`, cwd-scoped) without re-injecting, since the
     *    guidance is already in that session's history. [sessionId] is therefore unused here.
     *
     * The cwd is the agent's document-tree workspace; it may not exist yet on a fresh machine (the
     * applet's `docs sync` clones into it), so we create it before entering — same as ClaudeDriver.
     */
    override fun command(sessionId: String, cwd: String?, resume: Boolean): List<String> {
        val autonomy = "-c approval_policy=never -c sandbox_mode=danger-full-access"
        var inner =
            if (resume) "exec codex resume --last $autonomy"
            else "exec codex $autonomy ${shellQuote(OperatorPrompt.TEXT)}"
        if (cwd != null) inner = "mkdir -p ${shellQuote(cwd)} && cd ${shellQuote(cwd)} && $inner"
        return listOf("bash", "-lc", inner)
    }

    private fun shellQuote(s: String): String = "'" + s.replace("'", "'\\''") + "'"
}
