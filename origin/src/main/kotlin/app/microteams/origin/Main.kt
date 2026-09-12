/*
 * The origin process: the server end of the MultiPath substrate, sitting in front of this
 * deployment.
 *
 * Why a separate process at all. Up to 0.1.6 MultiPath was a choice of URL made inside each client,
 * and the server end was a servlet filter — the application itself had to know that more than one
 * path to it existed. From 0.2.0 the substrate is a transport: a client brings up ONE redundant
 * stream carried over every line at once, and each exchange is a mux stream on top of it. Something
 * has to terminate that, demultiplex it, and hand the application an ordinary connection. That is
 * this process, and it is the only thing in the deployment that knows any of it.
 *
 * Where a stream goes. A normal stream is spliced to nginx, NOT to the backend. That looks like the
 * longer way round and it is deliberate: a request that arrives over the substrate must reach
 * exactly the same place as the same request made directly, and it is nginx that knows where that
 * is — /api/ to the auth service, /mt/ to the backend WITH the prefix stripped, everything else to
 * static files. Splicing to the backend instead would mean a request carried over a line needed a
 * different path from the same request over plain HTTP, which is precisely the sort of difference
 * this layer exists to abolish.
 *
 * One service, named "app", and nothing else. A client does not name an address any more — it names
 * a service, and the origin looks that name up in the registry below; a name that is not in it is
 * refused before anything is dialled. So the open-relay surface this layer could have had is absent
 * by construction rather than by an allow-list somebody had to remember to write.
 *
 * One service covers everything the product does over the wire: ordinary requests, responses that
 * arrive gradually, and WebSockets. They are all just bytes on a stream to the same HTTP stack, and
 * splitting them into several names would be inventing a distinction the application does not have.
 *
 * A handler may serve a stream in-process, and the library prefers that — a loopback port is attack
 * surface a named service does not have. Not here: our service IS a real address, the whole HTTP
 * stack behind nginx, and serving it in-process would mean reimplementing nginx inside this
 * process.
 */
package app.microteams.origin

import app.microteams.multipath.Origin
import app.microteams.multipath.redundant.RedundantOptions
import java.net.ServerSocket

/**
 * The one name every client opens a stream to.
 *
 * A contract between this process and all four clients, so it is written down rather than typed out
 * in five places: a name the origin does not know is refused, which means a typo on either side is
 * total rather than partial — and the four repositories cannot share a constant, so the next best
 * thing is for each to say where the name comes from.
 */
const val APP_SERVICE = "app"

private fun env(name: String, fallback: String): String =
    System.getenv(name)?.takeIf { it.isNotBlank() } ?: fallback

fun main() {
    val port = env("MT_ORIGIN_PORT", "9443").toInt()
    val appHost = env("MT_APP_HOST", "nginx")
    val appPort = env("MT_APP_PORT", "80").toInt()
    val linkPath = env("MT_LINK_PATH", "/mt/link")

    // The MAXIMUM number of links one client may attach to its redundant stream — not the number of
    // lines this deployment publishes. A client whose link index is at or above this is turned away.
    //
    // It used to be turned away in silence: the link attached, carried nothing, and the client
    // waited forever on a stream that would never be served, with nothing in any log. That is how I
    // found it, having set this to 0. The library now refuses out loud (a REJECT frame carrying the
    // reason), so the failure is at least visible — but the value still wants to be generous, since
    // a client with more lines than the origin expects should not be a failure at all and a spare
    // slot costs one array element.
    val maxLines = env("MT_MAX_LINES", "16").toInt()

    // No sslContext: nginx terminates TLS in front of this process, so what arrives here is a
    // plaintext WebSocket on the compose network. Raw-TLS direct links are a deployment that does
    // not have a proxy in front; ours always does.
    val origin = Origin(ServerSocket(port), RedundantOptions(n = maxLines), null, linkPath)

    println(
        "multipath origin listening on $port, service \"$APP_SERVICE\" at $appHost:$appPort, " +
            "links at $linkPath, max $maxLines links per client",
    )
    System.out.flush()
    origin.serve(mapOf(APP_SERVICE to Origin.dialService(appHost, appPort)))
}
