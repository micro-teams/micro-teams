/*
 *  Description: The pi driver — peer of ClaudeDriver and CodexDriver, one of the places that know
 *               a specific agent program exists. Like the others it is exactly two things: the argv
 *               that launches/resumes a pi session, and the applet (pi.js) that reads its terminal.
 *               Which model pi talks to is the machine operator's concern (~/.pi/agent/models.json),
 *               exactly as Claude's auth and Codex's config.toml are — the backend stays
 *               model-agnostic.
 *
 *               pi is the simplest program we drive. It has no trust screen, no consent dialog, and
 *               no first-run wizard: tools run without asking, and a fresh session opens straight to
 *               the prompt. There is nothing to pre-mark for onboarding the way Claude needs, and no
 *               permission flag to add the way Claude and Codex carry. So the argv is short.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.agent.driver

import app.microteams.agent.AppletStore
import org.springframework.stereotype.Component

@Component
class PiDriver(private val appletStore: AppletStore) : AgentDriver {
    override val name = "pi"

    override val appletSource: String by lazy { appletStore.require("pi.js") }

    /**
     * Launch (or resume) one pi session.
     *
     * We control pi's session id with `--session-id <id>` for BOTH directions: pi creates the
     * session when the id is new and resumes it when it already exists, so the caller never has to
     * say which it meant — the same "we mint [sessionId] ourselves, so a screen can be resumed
     * after a restart" contract the interface states. (Claude needs a separate `--resume` flag; pi
     * does not.)
     *
     * The standing operator instructions ride in `--append-system-prompt`, injected once here at
     * launch — the same channel ClaudeDriver uses. They apply for the whole session and *append to*
     * (never replace) whatever AGENTS.md the working repo carries, which matters when the cwd is a
     * real code checkout with its own.
     *
     * The cwd is the agent's document-tree workspace, and it doubles as pi's session scope: pi
     * keeps each project's sessions under `~/.pi/agent/sessions/--<cwd-slug>--/`, so resuming from
     * a different directory would silently start a blank session. enterCwd precedes the launch for
     * the same reason it does for Claude and Codex — and to create the directory first, since it
     * may not exist yet on a fresh machine.
     */
    override fun command(sessionId: String, cwd: String?, resume: Boolean): List<String> {
        var inner =
            "exec pi --session-id $sessionId " +
                "--append-system-prompt ${shellQuote(OperatorPrompt.TEXT)}"
        if (cwd != null) inner = enterCwd(cwd) + inner
        return listOf("bash", "-lc", inner)
    }
}
