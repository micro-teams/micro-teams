/*
 *  Description: Our service worker, because Flutter's is being taken away.
 *
 *               Flutter still emits flutter_service_worker.js, but its loader no longer registers
 *               it on a first visit unless you pass an explicit serviceWorkerUrl — and doing that
 *               prints "Loading the service worker using Flutter bootstrap is deprecated and will
 *               stop working in a future release". Building the offline story of a client we intend
 *               to keep on top of that is building on sand, so this is ours.
 *
 *               It also lets us decide what to keep, which a generated worker cannot. The engine is
 *               megabytes of wasm and the browser picks ONE variant at runtime out of several the
 *               build ships; precaching all of them would spend a first visit downloading things
 *               that browser will never ask for. So:
 *
 *                 * the shell — the document, the loader, the manifest and the icons — is
 *                   precached, because it is small and nothing starts without it;
 *                 * everything else is cached as it is actually fetched, which means after one
 *                   visit the cache holds exactly the variant this browser chose.
 *
 *               The consequence, stated plainly: the FIRST visit needs the network. It always did.
 *               Every visit after it does not.
 *
 *               It also carries the network. Every request this worker cannot answer from its cache
 *               goes over the MultiPath substrate — one redundant stream to the origin, carried
 *               across every line the deployment publishes — rather than over the browser's own
 *               connection. The page never learns: it calls fetch() exactly as it always did, and
 *               the worker is the seam where "the network" stops meaning "one host".
 *
 *               Which is why the caching decisions below are untouched by that. The substrate
 *               replaces the transport under `fetch`, not the rules about what may be answered from
 *               disk — those are about staleness, and staleness is not a network property.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 */

import { Client } from "@micro-teams/multipath";

// Replaced at build time by tool/make-sw.mjs with the bundle's version — the same string the
// launcher carries and /version serves. A new build is a new cache, and the old one is deleted on
// activation. Noticing that a NEWER build exists is not this file's job any more: a worker asking
// whether it is stale is a cached thing asking a question about itself, and it lived on a
// 60-second timer that a deploy plus a reload fitted comfortably inside. The launcher asks, on the
// one request of a page load that cannot be answered from a cache. See tool/launcher.mjs.
const VERSION = "__MT_BUILD__";
const CACHE = `microteams-${VERSION}`;

/**
 * The one service name every stream is addressed to.
 *
 * A contract with the origin rather than a local choice: a client names a SERVICE and the origin
 * looks it up, so a name it does not know is refused outright — which makes a typo here total rather
 * than partial. One name covers everything: ordinary requests, responses that arrive gradually, and
 * WebSockets, because they are all bytes on a stream to the same HTTP stack.
 */
const APP_SERVICE = "app";

/** The live substrate, once there is one. Null until then, and null forever in a worker that could
 * not bring one up — see startDialling. */
let client = null;
let dialling = false;

/**
 * Brings the substrate up in the BACKGROUND, and never makes a request wait for it.
 *
 * This is the whole shape of it, and the first version got it wrong in a way worth writing down: it
 * awaited the dial on the first request that needed one. A dial that fails rejects and is easy to
 * recover from — but a dial that HANGS (every line unreachable, or a line that accepts a socket and
 * never completes the handshake) simply never settles, and then every request behind it waits
 * forever. The app loaded to 99% and never painted, and the same thing happened on Flutter's own
 * document where none of this code is even involved. A transport that might never come up must not
 * be something a page waits on.
 *
 * So: requests go directly until there is a live client, and over it once there is. The cost is that
 * the first few requests of a cold worker have no redundancy, which is the right trade — they are
 * the ones a person is waiting for.
 */
/**
 * How long the transport gets to come up before this worker stops trying.
 *
 * There is no way to ask the library to give up: its dial never resolves while no line is reachable,
 * it retries for as long as the worker lives, and there is no handle to cancel. That is not free —
 * the failing sockets go to the same host the page loads from, and they starve the page's own
 * requests. So the budget is enforced from outside, by refusing to hand out any more sockets once it
 * is spent: the library's next reconnect gets one that never opens and never errors, so the loop
 * stops there. Ugly, and honest about it — the alternative is a page that a missing origin process
 * can stall.
 */
const DIAL_BUDGET_MS = 8000;

/** A socket that does nothing, so a retry loop with nothing left to try quietly stops. */
class SpentSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0; // CONNECTING, forever
    this.binaryType = "arraybuffer";
  }
  addEventListener() {}
  removeEventListener() {}
  send() {}
  close() {}
}

/** WebSocket while the budget lasts, nothing afterwards. */
function budgetedSocket() {
  const deadline = Date.now() + DIAL_BUDGET_MS;
  return function (url, protocols) {
    if (Date.now() > deadline) {
      console.warn("sw: giving up on the substrate, sending directly from here on");
      return new SpentSocket(url);
    }
    return new WebSocket(url, protocols);
  };
}

/** True when this deployment answers /mt/link with a 404 — the one answer that means "no origin". */
async function noLinkEndpoint() {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), 1000);
  try {
    const probe = await fetch("/mt/link", { signal: stop.signal, cache: "no-store" });
    return probe.status === 404;
  } catch (_) {
    return false; // aborted or refused: not a 404, so not a "definitely not here"
  } finally {
    clearTimeout(timer);
  }
}

function startDialling() {
  if (client || dialling) return;
  dialling = true;
  (async () => {
    // Is there a substrate here at all? Asked first, and cheaply, because dialling one that does
    // not exist is the expensive mistake: the redundant transport retries every line forever, and
    // those failing sockets go to the same host the page is loading from.
    //
    // A 404 is the deployment saying it has no origin process in front of it — nginx routes
    // /mt/link there and nowhere else. Anything else, including a request that hangs (an origin
    // reading a plain GET as a link will never answer it), means one is there and the dial is worth
    // making. So the timeout below counts as a yes, not a no.
    if (await noLinkEndpoint()) throw new Error("this deployment serves no /mt/link");

    // Fetched directly, and it has to be: it is the answer to "which lines exist", so it cannot
    // travel over them.
    const response = await fetch("/mt/lines", { cache: "no-store" });
    if (!response.ok) throw new Error(`the line registry answered ${response.status}`);
    const registry = await response.json();
    // As WebSocket URLs, because that is what a link is. The registry deals in origins —
    // "https://host" — since that is what a line IS and every other use of one wants it that way,
    // but `new WebSocket("https://…")` throws before anything reaches the network. The conversion
    // belongs here, at the one place that dials.
    const lines = (registry.lines ?? [])
      .map((line) => line.url || self.location.origin)
      .filter(Boolean)
      .map((url) => (url.startsWith("http") ? url.replace("http", "ws") : url));
    if (!lines.length) throw new Error("the line registry named no line");
    client = await Client.dial(lines, { wsCtor: budgetedSocket() });
  })().catch((error) => {
    // Said out loud, because a deployment that silently has no redundancy is the state this whole
    // layer exists to make impossible to be in unknowingly. Not retried in this worker: a worker is
    // short-lived and restarted often, so the next one tries again from nothing, and retrying per
    // request would put a registry fetch in front of every request the app makes.
    console.warn("sw: no substrate, sending directly:", error);
  });
}

/** fetch, over the substrate when one is up, over the browser until then. */
function net(request) {
  if (!client) return fetch(request);
  return client.fetch(APP_SERVICE, request).catch((error) => {
    console.warn("sw: falling back to a direct request:", error);
    return fetch(request);
  });
}

/**
 * The files whose NAMES never change, and which therefore may not be answered from cache without
 * asking. Flutter emits `main.dart.js` under that name for every build it will ever produce.
 */
const CODE = ["/", "/index.html", "/app.html", "/flutter_bootstrap.js", "/main.dart.js"];

/** What the app cannot start without. Everything else arrives through the fetch handler. */
const SHELL = [
  // "/" and "/index.html" are the multipath launcher (tool/launcher.mjs), not Flutter's document:
  // the first request cannot be spread across lines, so it is small and does one job. "/app.html"
  // is Flutter's own document, kept as the way to start without the launcher when the launcher
  // itself is what somebody is debugging.
  "/",
  "/index.html",
  "/app.html",
  "/flutter.js",
  "/flutter_bootstrap.js",
  "/manifest.json",
  "/favicon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Individually, not addAll: one 404 in the list must not throw away the whole install and
      // leave the app with no worker at all.
      await Promise.all(
        SHELL.map(async (url) => {
          try {
            await cache.add(new Request(url, { cache: "reload" }));
          } catch (e) {
            console.warn("sw: could not precache", url, e);
          }
        }),
      );
      // NOT skipWaiting. A worker that takes over while a page is loading replaces the thing
      // answering that page's requests half way through it, and everything still in flight — the
      // engine, the fonts, a chunk of code — is dropped. That is what "the first load after an
      // update fails" was. This one waits until the pages it would be replacing have gone, which
      // is the only moment when taking over costs nobody anything.
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Safe here in a way it was not before: without skipWaiting, activation only happens once the
      // pages the previous worker was serving have gone, so nothing is mid-load when these caches
      // disappear.
      for (const name of await caches.keys()) {
        if (name.startsWith("microteams-") && name !== CACHE) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // What the worker's own transport is doing, answered by the worker itself.
  //
  // It exists because the page cannot see it. On the web the substrate lives in here, so the app's
  // own line panel would otherwise have nothing to show and no way to get it — and the one thing
  // that layer needs is somewhere to say "this line is dead" out loud, since losing a line costs
  // nobody an error. A path under /__mt/ rather than a postMessage protocol: the panel already
  // speaks HTTP, and a request is something a person can also just open in a tab.
  if (url.pathname === "/__mt/transport") {
    event.respondWith(
      (async () => {
        const lines = client
          ? client.stats().map((stat) => ({
              index: stat.index,
              state: stat.state,
              lastByteMs: stat.lastByteMs,
              reconnects: stat.reconnects,
              reason: stat.reason,
            }))
          : [];
        return new Response(JSON.stringify({ lines }), {
          headers: { "content-type": "application/json" },
        });
      })(),
    );
    return;
  }

  // The API is never cached — a stale answer about who is online, or a replayed message, is worse
  // than an error — but it IS carried, and that matters more than the caching does. It is the
  // traffic redundancy is for: static assets are fetched once and then come from disk forever,
  // while every message, every roster and every document goes over the network every time.
  //
  // Routing it here rather than in the Dart client means one transport per page instead of two. The
  // application's own client used to dial its own; with this worker in front of it, a second
  // redundant stream would be a second set of links to every line doing the same job.
  //
  // The registry itself is the exception, and has to be: it is the answer to "which lines exist", so
  // it cannot travel over them. `transport()` fetches it directly for exactly this reason, and this
  // guard keeps a page's own call to it from being routed either.
  if (url.pathname === "/mt/lines") return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/mt/")) {
    // The dial starts HERE, on the first application request, rather than on the first request of
    // any kind. Two reasons, and the second one cost a day:
    //
    // This is the traffic the substrate is for. Static assets are fetched once and then come from
    // the cache forever; the API is what crosses the network for the rest of the session.
    //
    // And a dial that cannot succeed is not free. Against a deployment with no origin process the
    // redundant transport retries every line, starting a few hundred milliseconds apart, and never
    // stops — nothing here waits on it, but the failing sockets go to the same host the page is
    // loading from, and they starve the engine's own requests. The symptom was an app that reached
    // 100% and never painted a frame, with no error anywhere. Starting on the first API request
    // keeps all of that out of the load somebody is watching.
    startDialling();
    event.respondWith(net(request));
    return;
  }

  // The escape hatch must always come from the network if the network is there — it is what people
  // are told to open when the cache itself is the problem. The build stamp likewise: a cached
  // answer to "what is deployed?" is an answer about the past, which is the one thing it must
  // never be.
  // Installers are not part of the app: they are megabytes somebody downloads once, and a browser
  // cache is the wrong place for them. Left to the rule below they would be cached forever, since
  // their paths never change.
  if (url.pathname.startsWith("/downloads/")) return;

  // The escape hatch and the version stamp always come from the network. The stamp especially: a
  // cached answer to "what is deployed?" is an answer about the past, which is the one thing it
  // must never be — and it is the answer the launcher decides with.
  if (url.pathname === "/unregister.html" || url.pathname === "/version") {
    return;
  }

  // A navigation to any route is answered with the document. This is the service-worker half of
  // nginx's try_files: /agents typed into the address bar has to open the app, offline too.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await net(request);
        } catch (_) {
          const cache = await caches.open(CACHE);
          return (
            (await cache.match("/index.html")) ??
            (await cache.match("/")) ??
            Response.error()
          );
        }
      })(),
    );
    return;
  }

  // The application's own code is asked for FIRST and cached second.
  //
  // Cache-first is right for the engine — megabytes of wasm whose name changes with the build that
  // produced it — and wrong for these three, whose names never change. Cache-first on them means a
  // deploy is picked up on the visit AFTER the one where it landed: the page you are looking at was
  // assembled from the old cache while the new worker was still installing. "One reload behind" is
  // indistinguishable from "not deployed" to whoever is looking.
  //
  // The cost of asking first is a conditional request: the server answers 304 when nothing changed
  // (see the no-cache rule in deploy/nginx.conf), so nothing is re-downloaded. And a failure falls
  // back to the cache, which is what keeps this offline-first rather than online-only.
  const isCode = CODE.includes(url.pathname);

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);

      if (isCode) {
        try {
          const fresh = await net(request);
          if (fresh.ok && fresh.type === "basic") {
            cache.put(request, fresh.clone());
          }
          return fresh;
        } catch (_) {
          const hit = await cache.match(request);
          if (hit) return hit;
          return Response.error();
        }
      }

      const hit = await cache.match(request);
      if (hit) return hit;
      const response = await net(request);
      // Opaque and error responses are not worth keeping; a cached failure is a failure that
      // repeats even after the problem is fixed.
      if (response.ok && response.type === "basic") {
        cache.put(request, response.clone());
      }
      return response;
    })(),
  );
});
