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
 * Tunnels are refused. A tunnel asks the origin to open a connection to somewhere else on the
 * caller's behalf; it is a real feature of 0.2.0 and nothing in this product uses it yet. An origin
 * that forwarded to an arbitrary target because the substrate permits it would be an open proxy
 * wearing our TLS certificate. When there is a feature that needs egress, this refusal becomes a
 * ticket check against the backend — deliberately, not by having been left open.
 */
package app.microteams.origin

import app.microteams.multipath.Origin
import app.microteams.multipath.redundant.RedundantOptions
import java.net.ServerSocket

private fun env(name: String, fallback: String): String =
    System.getenv(name)?.takeIf { it.isNotBlank() } ?: fallback

fun main() {
    val port = env("MT_ORIGIN_PORT", "9443").toInt()
    val appHost = env("MT_APP_HOST", "nginx")
    val appPort = env("MT_APP_PORT", "80").toInt()
    val linkPath = env("MT_LINK_PATH", "/mt/link")

    // The MAXIMUM number of links one client may attach to its redundant stream — not the number of
    // lines this deployment publishes. The origin indexes its per-link state by the index the client
    // sends, and an index at or above this is REFUSED, silently: the link attaches, carries nothing,
    // and the client waits forever on a stream that will never be served. That is exactly how this
    // was found (the value was 0 and every request hung with no error anywhere), so the default is
    // generous on purpose — a client with more lines than the origin expects must never be the
    // failure, and the cost of a spare slot is one array element.
    val maxLines = env("MT_MAX_LINES", "16").toInt()

    // No sslContext: nginx terminates TLS in front of this process, so what arrives here is a
    // plaintext WebSocket on the compose network. Raw-TLS direct links are a deployment that does
    // not have a proxy in front; ours always does.
    val origin = Origin(ServerSocket(port), RedundantOptions(n = maxLines), null, linkPath)
    val route = Origin.route(local = Origin.dialLocal(appHost, appPort), egress = null)

    println("multipath origin listening on $port, app at $appHost:$appPort, links at $linkPath, max $maxLines links per client")
    System.out.flush()
    origin.serve(route)
}
