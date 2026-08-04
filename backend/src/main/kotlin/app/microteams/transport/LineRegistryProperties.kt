/*
 *  Description: The line registry, as deployment configuration.
 *
 *               Which public routes exist is a property of how this instance is deployed -- an
 *               operator adds a tunnel or a proxy and it becomes true -- so it is configuration
 *               rather than data. It is maintained by hand on purpose: whether a free reverse proxy
 *               is worth keeping is a judgement about cost and trust, and a health check cannot
 *               make it. Whether a line is reachable *right now* is a different question, and the
 *               client answers that one itself by probing.
 *
 *  Author(s):
 *      agent3
 */

package app.microteams.transport

import jakarta.annotation.PostConstruct
import org.springframework.boot.context.properties.ConfigurationProperties

@ConfigurationProperties(prefix = "application.multipath")
data class LineRegistryProperties(val lines: List<Line> = emptyList()) {

    /**
     * Reject a malformed registry at startup rather than serving it.
     *
     * The client validates too, and on failure keeps the same-origin line — which means a typo here
     * would not break anything visibly, it would just quietly switch multi-line off and leave
     * everyone wondering why the second route is never used. Refusing to start is louder and
     * happens while the operator is still looking at the change they just made.
     */
    @PostConstruct
    fun validate() {
        val seen = mutableSetOf<String>()
        lines.forEachIndexed { index, line ->
            require(line.id.isNotBlank()) {
                "application.multipath.lines[$index].id must not be empty"
            }
            require(seen.add(line.id)) {
                "application.multipath.lines[$index].id is a duplicate: \"${line.id}\" — " +
                    "duplicate ids make every metric and the developer panel lie about which " +
                    "line served what"
            }
            require(line.url.isEmpty() || ORIGIN.matches(line.url)) {
                "application.multipath.lines[$index].url must be an absolute origin with no path " +
                    "and no trailing slash (or empty for same-origin), got \"${line.url}\""
            }
        }
    }

    /**
     * Every configured line's origin, for the CORS allowlist. Same-origin entries contribute none.
     */
    fun origins(): List<String> = lines.map { it.url }.filter { it.isNotEmpty() }.distinct()

    private companion object {
        /** Mirrors the TS and Go registry parsers: scheme + host, nothing else. */
        val ORIGIN = Regex("^https?://[^/]+$")
    }

    /**
     * One route to this origin.
     *
     * Every line must reach the *same* backend process: they are different network paths, not
     * replicas. Everything MultiPath does rests on that, and nothing here can check it.
     */
    data class Line(
        val id: String = "",
        /**
         * Absolute origin, no path, no trailing slash; empty means "wherever the client came from".
         */
        val url: String = "",
        val transport: String? = null,
        val weight: Int? = null,
        val foreignOrigin: Boolean? = null,
    )
}
