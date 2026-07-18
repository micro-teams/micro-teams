/*
 *  Description: Where the backend reads applet bundles from. In a deployment the applets are an
 *               independent build artifact mounted at `application.applets-dir` (so they can be
 *               swapped without rebuilding the jar — the same "server-authored, evolvable" idea the
 *               applet system exists for). When that is unset — tests and a standalone jar — it
 *               falls back to the classpath copy under `applets/` (which the applets module's build
 *               refreshes into src/test/resources). The production jar carries no applets, so a
 *               real deployment must set application.applets-dir.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.agent

import java.io.File
import org.springframework.beans.factory.annotation.Value
import org.springframework.core.io.ClassPathResource
import org.springframework.stereotype.Component

@Component
class AppletStore(@Value("\${application.applets-dir:}") private val appletsDir: String) {

    /** The bundle named [name] (e.g. "cli.js", "claude.js"), or null if neither source has it. */
    fun read(name: String): String? {
        if (appletsDir.isNotBlank()) {
            val f = File(appletsDir, name)
            return if (f.isFile) f.readText() else null
        }
        val res = ClassPathResource("applets/$name")
        return if (res.exists()) res.inputStream.bufferedReader().use { it.readText() } else null
    }

    /** Like [read] but fails loudly — for a bundle the backend cannot function without. */
    fun require(name: String): String =
        read(name)
            ?: error(
                "applet '$name' not found: set application.applets-dir to the mounted applets " +
                    "directory, or ensure the classpath fallback is present"
            )
}
