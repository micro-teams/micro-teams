// The network paths this app may reach the backend over.
//
// Today there is exactly one, and it is the page's own origin — so every request goes out byte for
// byte as it did before MultiPath existed. That is the whole point of this step: put the plumbing
// in place while the routing decision is still trivial, so that adding a real second line later
// changes a registry and nothing else. Doing it the other way round means introducing the plumbing
// and the risk on the same day.
//
// Startup now refreshes that registry from GET /mt/lines and begins measuring. Both are safe to
// fail: the inline line is what the app was going to use anyway, so a registry that does not arrive
// costs nothing, and a client that refused to start because it could not fetch a routing table
// would have made the transport layer a startup dependency — exactly backwards for a thing whose
// job is to survive one route being down.

import {
  LineManager,
  SENTINEL_ORIGIN,
  parseRegistry,
} from "@micro-teams/multipath";

/** The prefix nt and the connector endpoints are served under (a vite/nginx proxy path). */
export const MT_PATH = "/mt";

/**
 * What the generated client must be configured with.
 *
 * The client insists on building absolute URLs from `basePath`, so MultiPath hands it a reserved
 * `.invalid` host and strips it back off inside `fetchApi`. Nothing ever resolves it: if one
 * escaped the adapter it would fail DNS immediately rather than reach some real server.
 */
export const MT_BASE_PATH = SENTINEL_ORIGIN + MT_PATH;

/**
 * The line the app starts with: the page's own origin.
 *
 * Inline rather than fetched, because the registry is what tells the app where the backend is, and
 * fetching it would mean asking the network where the network is. GET /mt/lines refines this; it
 * cannot be what bootstraps it.
 */
export const registry = parseRegistry({
  lines: [{ id: "origin", url: "", transport: "same-origin", weight: 100 }],
});

/**
 * The single manager for the whole app.
 *
 * A module-level instance because it is a routing table, not a component's state: two of them would
 * be two opinions about which line is fastest, and the measurements each one made would be invisible
 * to the other.
 */
export const lineManager = new LineManager({
  registry,
  // Resolved per call rather than captured at construction. This module is imported once, at
  // startup, so binding the global then would freeze whatever `fetch` existed at that instant —
  // which is the wrong answer for anything that installs its own later (a test, an instrumentation
  // wrapper), and is invisible until one does.
  fetch: (input, init) => globalThis.fetch(input, init),
});

/**
 * Adopt the deployment's real registry, then start measuring.
 *
 * Called once at startup. Everything here is best-effort by design:
 *
 * - a registry that does not arrive leaves the same-origin line in place, which is what the app
 *   would have used anyway;
 * - a *malformed* registry is likewise ignored rather than fatal, because the failure it would
 *   otherwise cause — an app that will not start — is worse than the one it prevents.
 *
 * Probing begins after the swap so the first measurements are of the lines we will actually use.
 */
export async function startLineManagement(): Promise<void> {
  let document: unknown;
  try {
    const response = await fetch(`${MT_PATH}/lines`, { cache: "no-store" });
    if (!response.ok) return lineManager.start();
    document = await response.json();
  } catch {
    // Offline, or the endpoint is not there yet. Keep the same-origin line and say nothing: that is
    // the ordinary case on a cold start with no network, and warning about it every time is noise.
    return lineManager.start();
  }

  try {
    lineManager.setRegistry(parseRegistry(document));
  } catch (error) {
    // A registry that arrived and could not be read is a different thing entirely, and it must not
    // be silent. Falling back is still right — one line beats none — but it leaves the deployment
    // believing multi-line is on while the client quietly uses one line, and that is invisible
    // exactly while there is only one line to compare against. It is how a null field in this
    // document went unnoticed until a real second line was added and did not appear.
    console.warn(
      "MultiPath: ignoring the line registry, keeping the same-origin line:",
      error,
    );
  }
  lineManager.start();
}
