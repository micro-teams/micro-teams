// The network paths this app may reach the backend over.
//
// Today there is exactly one, and it is the page's own origin — so every request goes out byte for
// byte as it did before MultiPath existed. That is the whole point of this step: put the plumbing
// in place while the routing decision is still trivial, so that adding a real second line later
// changes a registry and nothing else. Doing it the other way round means introducing the plumbing
// and the risk on the same day.
//
// The manager is deliberately not started: probing means a request every fifteen seconds to
// GET /mt/probe, an endpoint that does not exist yet. With one line there is also nothing to rank.
// When the endpoint lands, this file gains `manager.start()` and a registry fetched from
// GET /mt/lines, and nothing else in the app has to know.

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
 * One line, the page's own origin.
 *
 * Inline rather than fetched, and not just because GET /mt/lines does not exist yet: the registry
 * is what tells the app where the backend is, so fetching it would mean asking the network where
 * the network is. A real deployment adds lines here (or from that endpoint once it exists); an
 * empty url means "wherever this page came from".
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
