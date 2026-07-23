/*
 *  Description: Small shell helpers shared by every AgentDriver — they all launch their program
 *               through `bash -lc`. `shellQuote` single-quotes a value for safe embedding; `enterCwd`
 *               is the prefix that moves into an agent's working directory before the launch.
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
