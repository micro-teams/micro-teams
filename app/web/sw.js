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
 *               It also carries the network, for the half of it nothing else can reach. Every
 *               request out of the page's own code goes over the redundant transport the Dart
 *               client dials (lib/src/common/multipath_adapter.dart) — but the engine, the assets
 *               and the fonts are fetched by the BROWSER, not by Dart, and a service worker is the
 *               only place those can be intercepted. So they are raced across every published line
 *               here; see the block above raceLines for why racing rather than ranking, and what it
 *               costs. It no longer speaks the MultiPath protocol itself, as it did before
 *               0.2.0-rc.3 when the page could not dial one: these are plain parallel fetches, and
 *               plain is the point on the path that has to start the application.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 */

// Replaced at build time by tool/make-sw.mjs with the bundle's version — the same string the
// launcher carries and /version serves. A new build is a new cache, and the old one is deleted on
// activation. Noticing that a NEWER build exists is not this file's job any more: a worker asking
// whether it is stale is a cached thing asking a question about itself, and it lived on a
// 60-second timer that a deploy plus a reload fitted comfortably inside. The launcher asks, on the
// one request of a page load that cannot be answered from a cache. See tool/launcher.mjs.
const VERSION = "__MT_BUILD__";
const CACHE = `microteams-${VERSION}`;

/**
 * Where this worker is, which is where the app is.
 *
 * A worker is served from the directory it controls, and unlike the documents it is fetched at ONE
 * fixed URL rather than at every route the app has — so it can simply read where it is, and is the
 * one part of the app that never has to be told: at /sw.js this is "/", at /app/sw.js it is
 * "/app/". (The documents cannot do this; they are served for every route, so they carry an
 * absolute base that tool/assemble-dist.mjs points at the mount.) Everything below is named
 * relative to it, so the same file works wherever the bundle puts the app. Hard-coding "/" here is
 * half of what T-093 was: the paths a worker caches and the paths it is asked for have to be the
 * same paths, and once the app moved under /app/ they were not.
 */
const BASE = new URL("./", self.location).pathname;

/**
 * The files whose NAMES never change, and which therefore may not be answered from cache without
 * asking. Flutter emits `main.dart.js` under that name for every build it will ever produce.
 */
const CODE = [BASE, `${BASE}index.html`, `${BASE}app.html`, `${BASE}flutter_bootstrap.js`, `${BASE}main.dart.js`];

/** What the app cannot start without. Everything else arrives through the fetch handler. */
const SHELL = [
  // BASE and index.html are the multipath launcher (tool/launcher.mjs), not Flutter's document:
  // the first request cannot be spread across lines, so it is small and does one job. app.html
  // is Flutter's own document, kept as the way to start without the launcher when the launcher
  // itself is what somebody is debugging.
  BASE,
  `${BASE}index.html`,
  `${BASE}app.html`,
  `${BASE}flutter.js`,
  `${BASE}flutter_bootstrap.js`,
  `${BASE}manifest.json`,
  `${BASE}favicon.svg`,
  `${BASE}icon-192.png`,
  `${BASE}icon-512.png`,
  `${BASE}icon-maskable-512.png`,
];

/**
 * The lines this deployment publishes, and the reason this file has a network opinion at all.
 *
 * A browser fetches the engine, the assets and the fonts itself — seventeen megabytes of them on a
 * cold load — and none of that goes through the Dart client, so none of it sees the redundant
 * transport the page dials. A service worker is the only thing in a browser that can intercept
 * those requests, which is the second reason this worker exists (the first is caching). Measured
 * against production: the page's own origin was the SLOWEST of the six published lines, 1.90s to
 * first byte against 0.59s for the best, and it is the one every asset goes over today.
 *
 * So every request this worker would have sent to one origin is sent to ALL of them at once and the
 * first answer wins; the rest are aborted. Racing rather than ranking is deliberate. A ranking has
 * to be measured before it is worth anything, and the load where this matters most — the first one
 * after a deploy, when every cache is empty — is exactly the load where nothing has been measured
 * yet. A race needs no prior knowledge, a dead line simply loses, and there is no timeout to tune.
 *
 * The cost is one set of headers per line per request, because losers are aborted as soon as a
 * winner answers rather than downloaded to completion. Deciding by completion instead would mean
 * holding every line's copy of an eight-megabyte font in memory to compare them, which is how you
 * run a phone out of memory; and it would forbid streaming, which is what the launcher's progress
 * bar is made of.
 *
 * This rests on every line fronting the SAME deployment — the frp lines tunnel back to one nginx,
 * and ops' "never add a backend replica" rule is what keeps it true. If a line ever pointed
 * somewhere else, this would serve one build's engine to another build's code.
 */
const LINES = `${BASE}__lines`; // a cache key for the registry, not a path anything serves
let lineOrigins = [];

function originsOf(registry) {
  const here = self.location.origin;
  const out = new Set([here]);
  for (const line of registry?.lines ?? []) {
    // "" is the page's own origin, which is already in. Anything unparseable is skipped rather than
    // thrown on: a malformed registry must cost redundancy, never the app.
    if (typeof line?.url !== "string" || line.url === "") continue;
    try {
      out.add(new URL(line.url).origin);
    } catch (_) {}
  }
  return [...out];
}

/**
 * Reads the registry from the cache first so a worker the browser just restarted can race
 * immediately, then refreshes it from the backend. Never awaited by a request: until it lands,
 * requests go over the page's origin exactly as they always did.
 */
async function loadLines() {
  const cache = await caches.open(CACHE);
  try {
    const held = await cache.match(LINES);
    if (held) lineOrigins = originsOf(await held.json());
  } catch (_) {}
  try {
    // Absolute: /mt is the backend, at the origin root, wherever the app is mounted.
    const fresh = await fetch("/mt/lines", { cache: "no-store" });
    if (!fresh.ok) return;
    const registry = await fresh.json();
    lineOrigins = originsOf(registry);
    await cache.put(
      LINES,
      new Response(JSON.stringify(registry), { headers: { "Content-Type": "application/json" } }),
    );
  } catch (_) {}
}

/** Whether a response is worth keeping. Cross-origin now, because a line that is not the page's is. */
const worthCaching = (response) =>
  response.ok && (response.type === "basic" || response.type === "cors");

/**
 * One request, every line, first answer wins.
 *
 * Losing lines are aborted the moment a winner answers. `credentials: "omit"` on the cross-origin
 * ones is not optional: those responses carry `Access-Control-Allow-Origin: *` (deploy/nginx.conf
 * sets it so the launcher can import its entry module across lines), and a wildcard and credentials
 * cannot be combined — with cookies attached the browser rejects every one of them. These are
 * public build artefacts and have no business carrying a session anyway.
 *
 * A non-ok answer is treated as a loss rather than a winner, so one line serving a 404 through a
 * half-finished deploy cannot beat five lines serving the file.
 */
function raceLines(request) {
  const origins = lineOrigins;
  if (origins.length < 2) return fetch(request);

  const here = self.location.origin;
  const url = new URL(request.url);
  const controllers = [];
  const attempts = origins.map((origin) => {
    const controller = new AbortController();
    controllers.push(controller);
    const attempt =
      origin === here
        ? fetch(request, { signal: controller.signal })
        : fetch(origin + url.pathname + url.search, {
            signal: controller.signal,
            credentials: "omit",
            mode: "cors",
          });
    return attempt.then((response) => {
      if (!response.ok) throw new Error(`${origin} answered ${response.status}`);
      return { response, controller };
    });
  });

  return Promise.any(attempts).then(
    (won) => {
      for (const controller of controllers) if (controller !== won.controller) controller.abort();
      return won.response;
    },
    // Every line failed. Reject the way a single fetch would, so the callers below fall back to the
    // cache exactly as they already do.
    (error) => {
      throw error;
    },
  );
}

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
      // Not awaited by anything that serves a request: until it lands, every fetch goes over the
      // page's own origin, which is what it did before this file had an opinion about lines.
      loadLines();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // The API is never cached — a stale answer about who is online, or a replayed message, is worse
  // than an error. It goes straight to the network, over the transport the page itself now dials.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/mt/")) return;

  // The escape hatch must always come from the network if the network is there — it is what people
  // are told to open when the cache itself is the problem.
  // Installers are not part of the app: they are megabytes somebody downloads once, and a browser
  // cache is the wrong place for them. Left to the rule below they would be cached forever, since
  // their paths never change.
  if (url.pathname.startsWith("/downloads/")) return;

  // The escape hatch and the version stamp always come from the network. The stamp especially: a
  // cached answer to "what is deployed?" is an answer about the past, which is the one thing it
  // must never be — and it is the answer the launcher decides with.
  // /version is at the ORIGIN root however the app is mounted — it answers for the deployment, not
  // for the app (see tool/assemble-dist.mjs) — while the escape hatch travels with the app.
  if (url.pathname === `${BASE}unregister.html` || url.pathname === "/version") {
    return;
  }

  // A navigation to any route is answered with the document. This is the service-worker half of
  // nginx's try_files: /agents typed into the address bar has to open the app, offline too.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await raceLines(request);
        } catch (_) {
          const cache = await caches.open(CACHE);
          return (
            (await cache.match(`${BASE}index.html`)) ??
            (await cache.match(BASE)) ??
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
          const fresh = await raceLines(request);
          if (worthCaching(fresh)) {
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
      const response = await raceLines(request);
      // Opaque and error responses are not worth keeping; a cached failure is a failure that
      // repeats even after the problem is fixed.
      if (worthCaching(response)) {
        cache.put(request, response.clone());
      }
      return response;
    })(),
  );
});
