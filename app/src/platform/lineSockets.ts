/*
 * How the MultiPath client opens its links on this platform: in a browser (and on iOS), with the
 * platform's WebSocket at every line's url.
 *
 * lineSockets — the Client options that say so: none, so every line is dialled at its url. A
 * browser cannot verify a certificate against another name than the one it connects to, so a
 * line's address (an IP that carries no TLS server name) is of no use here; see
 * lineSockets.android.ts for the platform that uses it.
 *
 * Example: new Client({ entry, ...lineSockets });
 */
import type { ClientOptions } from "@micro-teams/multipath";

export const lineSockets: Pick<ClientOptions, "dialAddresses" | "WebSocket"> = {};
