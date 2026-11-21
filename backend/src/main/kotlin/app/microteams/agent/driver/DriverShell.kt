/*
 *  Description: Small shell helpers shared by every AgentDriver — they all launch their program
 *               through `bash -lc`. `shellQuote` single-quotes a value for safe embedding; `enterCwd`
 *               is the prefix that moves into an agent's working directory before the launch;
 *               `onTmuxPath` is the prefix that puts the connector's tmux first on the PATH.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.agent.driver

/** Single-quote [s] for safe embedding in a bash command. */
fun shellQuote(s: String): String = "'" + s.replace("'", "'\\''") + "'"

/**
 * The prefix that enters an agent's working directory before launching its program, ending with `
 * && ` so the launch command follows. Two things it handles:
 * - creates the directory first (it may not exist yet on a fresh machine — the applet's `docs sync`
 *   clones into it);
 * - expands a leading `~` to $HOME on the machine, so a caller may give a home-relative path like
 *   `~/work/repo` (plain single-quoting would keep the `~` literal).
 */
fun enterCwd(cwd: String): String =
    "_mtcwd=${shellQuote(cwd)}; _mtcwd=\"\${_mtcwd/#\\~/\$HOME}\"; " +
        "mkdir -p \"\$_mtcwd\" && cd \"\$_mtcwd\" && "

/**
 * The prefix that puts the directory of the tmux hosting the screen first on the PATH, so a program
 * that runs `tmux` (Claude Code copies a selection with `tmux load-buffer -w`) reaches the binary
 * of its own server. The connector names it in MICROTEAMS_TMUX; a login shell rebuilds the PATH, so
 * it is set here, after the profile. A connector that does not name it leaves the PATH as it is.
 */
const val onTmuxPath =
    "[ -n \"\${MICROTEAMS_TMUX:-}\" ] && PATH=\"\${MICROTEAMS_TMUX%/*}:\$PATH\"; "
