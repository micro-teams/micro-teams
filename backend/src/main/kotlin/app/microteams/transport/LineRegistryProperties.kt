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

import org.springframework.boot.context.properties.ConfigurationProperties

@ConfigurationProperties(prefix = "application.multipath")
data class LineRegistryProperties(val lines: List<Line> = emptyList()) {
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
