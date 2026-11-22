/*
 * How the MultiPath client opens its links on Android: a line with an address is dialled at that
 * IP, which carries no TLS server name, and its certificate is verified against the line's name.
 *
 * Some networks reset every TLS connection whose server name is a domain they filter, and
 * Android's small ClientHello always shows it. The client (dialAddresses) dials such a line at
 * `wss://<address>/...` with the line's host in the Host header; the WebSocket below registers that
 * host for the IP with the LineNames native module (modules/line-names) before it opens, and the
 * module's hostname verifier then checks the certificate against the name instead of the IP. The
 * chain is checked by the platform as for every connection.
 *
 * lineSockets — the Client options that do this: dialAddresses, and the WebSocket that registers
 *   the name.
 *
 * Example: new Client({ entry, ...lineSockets });
 */
import type { ClientOptions, WebSocketConstructor } from "@micro-teams/multipath";
import { requireNativeModule } from "expo-modules-core";

const lineNames = requireNativeModule<{ verifyAs(url: string, host: string): void }>("LineNames");

class AddressedWebSocket extends WebSocket {
  constructor(url: string, protocols?: string[], options?: { headers: Record<string, string> }) {
    const host = options?.headers.Host;
    if (host) lineNames.verifyAs(url, host);
    // @ts-expect-error React Native's WebSocket takes options (headers); the DOM type does not.
    super(url, protocols, options);
  }
}

export const lineSockets: Pick<ClientOptions, "dialAddresses" | "WebSocket"> = {
  dialAddresses: true,
  // The DOM's WebSocket type, which React Native's global carries, types its handlers' events more
  // narrowly than the client's WebSocketLike; the object is the one the client uses by default.
  WebSocket: AddressedWebSocket as unknown as WebSocketConstructor,
};
