/*
 * Lets a WebSocket that dials a line's IP address verify the certificate against the line's name.
 *
 * Some networks reset every TLS connection whose server name (SNI) is a domain they filter. A
 * connection to an IP address carries no server name, so the MultiPath client dials such a line at
 * its address (`wss://203.0.113.7:8443/...`) with the line's name in the Host header. OkHttp would
 * then check the certificate against the IP. This module gives React Native's WebSockets a hostname
 * verifier that checks it against the name instead, for the addresses (IP and port) registered
 * here, and exactly as OkHttp does by default for every other host. The chain is checked by the platform's trust manager
 * as for any connection; only the name compared with the certificate changes, never whether it is.
 *
 * JS interface (module "LineNames"):
 *   verifyAs(url, host) — the WebSocket about to open `url` (ws:// or wss://, an IP literal as its
 *     host) is to verify the certificate against `host` (a name, with or without a port, as in a
 *     Host header). The address is url's IP and port; one name is kept per address, the latest
 *     registered (a line list names one host per address), as long as the process lives.
 *
 * Example: requireNativeModule("LineNames").verifyAs("wss://203.0.113.7:8443/multipath/v3/link",
 *   "relay.example.app:8443"); new WebSocket(...) then verifies against relay.example.app.
 *
 * The verifier is installed with WebSocketModule.setCustomClientBuilder when the module is created,
 * which applies to every WebSocket connection and to nothing else (fetch keeps its own client).
 */
package app.microteams.linenames

import com.facebook.react.modules.websocket.WebSocketModule
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.ConcurrentHashMap
import javax.net.ssl.HostnameVerifier
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.internal.tls.OkHostnameVerifier

class LineNamesModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("LineNames")

    OnCreate { WebSocketModule.setCustomClientBuilder { it.hostnameVerifier(verifier) } }

    Function("verifyAs") { url: String, host: String ->
      // Parsed by OkHttp's own parser, so the key is the host string OkHttp later verifies.
      val address = ("https:" + url.substringAfter(':')).toHttpUrl()
      names["${address.host}:${address.port}"] = "https://$host".toHttpUrl().host
    }
  }

  private companion object {
    val names = ConcurrentHashMap<String, String>()

    // OkHttp passes the URL's host (the IP) and the session, whose peer port is the URL's port.
    val verifier = HostnameVerifier { host, session ->
      OkHostnameVerifier.verify(names["$host:${session.peerPort}"] ?: host, session)
    }
  }
}
