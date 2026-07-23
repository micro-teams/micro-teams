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

    /**
     * The codex applet, with [OperatorPrompt] injected in place of its `"__MT_OPERATOR_PROMPT__"`
     * placeholder (as a JS string literal). Codex has no system prompt, and passing the
     * instructions as codex's initial prompt made the agent start working on its own at launch — so
     * instead the applet prepends them to the FIRST group message. Injecting them here keeps the
     * guidance with the driver, exactly as ClaudeDriver owns it, and the backend still never runs
     * Codex itself.
     */
    override val appletSource: String by lazy {
        appletStore
            .require("codex.js")
            .replace("\"__MT_OPERATOR_PROMPT__\"", jsStringLiteral(OperatorPrompt.TEXT))
    }

    /**
     * Launch (or resume) one Codex session.
     *
     * **Autonomy.** Codex has no `--dangerously-skip-permissions`; the equivalent is
     * `--dangerously-bypass-approvals-and-sandbox`, which skips approvals AND the sandbox entirely.
     * Without it Codex sandboxes the shell commands the agent runs and the document-tree flow fails
     * — `microteams api docs sync` writes the CLI applet cache outside the cwd and needs the
     * network, both denied by Codex's default sandbox ("Read-only file system").
     *
     * **No initial prompt.** We launch codex with no prompt so it just waits; the standing
     * instructions ride with the first group message (see [appletSource]). Codex mints its own
     * session ids, so on reboot we continue the most recent session for this cwd (`resume --last`,
     * cwd-scoped) rather than a caller-supplied [sessionId], which is therefore unused here.
     *
     * The cwd is the agent's document-tree workspace; it may not exist yet on a fresh machine (the
     * applet's `docs sync` clones into it), so we create it before entering — same as ClaudeDriver.
     */
    override fun command(sessionId: String, cwd: String?, resume: Boolean): List<String> {
        val autonomy = "--dangerously-bypass-approvals-and-sandbox"
        var inner = if (resume) "exec codex $autonomy resume --last" else "exec codex $autonomy"
        if (cwd != null) inner = enterCwd(cwd) + inner
        return listOf("bash", "-lc", inner)
    }

    /** Encode [s] as a JavaScript double-quoted string literal for injection into the applet. */
    private fun jsStringLiteral(s: String): String =
        "\"" +
            s.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r")
                .replace("\t", "\\t") +
            "\""
}
