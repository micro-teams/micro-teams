/*
 *  Description: The dsh driver — DeepSeek Harness, peer of Claude, Codex and pi. Like the others it
 *               is exactly two things, the argv and the applet, with one difference in what the argv
 *               starts: dsh has no terminal UI, so the screen runs `microteams acp-screen` (our thin
 *               front end in the connector, cli/internal/acpscreen), which speaks ACP to
 *               `dsh --profile acp` and paints a transcript with a status line. The applet (dsh.js)
 *               reads that status line, and chat messages are pasted in exactly as for the others.
 *
 *               Unlike the other drivers, dsh can take its model API from MicroTeams rather than the
 *               machine: a per-agent setting (AgentLlm) arrives in the screen environment, and the
 *               launch script (resources/drivers/dsh-launch.sh) turns it into dsh's own terms. With
 *               no setting, dsh uses whatever its machine is configured with, like every other
 *               driver.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.agent.driver

import app.microteams.agent.AppletStore
import org.springframework.stereotype.Component

@Component
class DshDriver(private val appletStore: AppletStore) : AgentDriver {
    override val name = "dsh"

    override val appletSource: String by lazy { appletStore.require("dsh.js") }

    private val launchScript: String by lazy {
        DshDriver::class.java.getResourceAsStream("/drivers/dsh-launch.sh")!!.bufferedReader().use {
            it.readText()
        }
    }

    /**
     * Launch (or resume) one dsh session. acp-screen resumes by itself when it has seen [sessionId]
     * before (it keeps the ACP session id under ours), so [resume] needs no flag — the same
     * create-or-resume contract pi's `--session-id` has.
     *
     * The operator prompt rides in MICROTEAMS_OPERATOR_PROMPT; acp-screen sends it with the first
     * message of a new session, because ACP has no system-prompt slot (Codex has the same gap). The
     * session id is passed as the script's first argument rather than spliced into it.
     */
    override fun command(sessionId: String, cwd: String?, resume: Boolean): List<String> {
        var inner =
            "export MICROTEAMS_OPERATOR_PROMPT=${shellQuote(OperatorPrompt.TEXT)}\n" + launchScript
        if (cwd != null) inner = enterCwd(cwd) + "\n" + inner
        return listOf("bash", "-lc", inner, "dsh-launch", sessionId)
    }
}
