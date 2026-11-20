/*
 *  Description: The seam that swapping Claude Code for Codex (or anything else) moves through.
 *               Everything that knows what the driven program *is* lives behind this interface,
 *               and it is exactly three things: how to launch it (the argv), the applet that
 *               drives its terminal, and the variables that applet is given. Nothing else in the backend mentions Claude.
 *
 *               The applet is the interesting half: it is JavaScript that runs in the CLI's
 *               embedded VM on the machine, reads the program's terminal, and mirrors variables
 *               back up. All of the per-program knowledge — what "working" looks like, where the
 *               token count is painted — is knowledge about pixels, so it belongs there rather
 *               than here. A driver's applet reports its own name on screenReady, so the wire
 *               already carries which driver a screen is running.
 *
 *               AgentDriver: name, appletSource, vars, viewerCommands,
 *               command(sessionId, cwd, resume).
 *               Example: hub.openScreen(m, driver.command(s, cwd, false), kind, driver.appletSource,
 *                        env, driver.vars)
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.agent.driver

/** How to launch and drive one kind of agent program. */
interface AgentDriver {
    /** Matches the `driver` the applet reports on screenReady (e.g. "claude"). */
    val name: String

    /** The applet source shipped into the screen to drive this program's terminal. */
    val appletSource: String

    /**
     * Control-plane variables the applet watches, set right after every session.create of this
     * driver's screens (open, re-adopt, wake). Setting one again is harmless, so a re-adopted
     * applet that already had them is unaffected.
     */
    val vars: Map<String, Any?>
        get() = emptyMap()

    /**
     * The applet functions a person watching the screen may call (a usage or compact button); the
     * live screen offers exactly these.
     */
    val viewerCommands: List<String>
        get() = emptyList()

    /**
     * The argv that launches (or resumes) one session of this program. We mint [sessionId]
     * ourselves rather than letting the program pick, so a screen can be resumed after a restart.
     */
    fun command(sessionId: String, cwd: String?, resume: Boolean): List<String>
}
