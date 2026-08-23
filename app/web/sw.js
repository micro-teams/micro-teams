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

  // The API and the sockets are never cached: a stale answer about who is online, or a replayed
  // message, is worse than an error.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/mt/")) return;

  // The escape hatch must always come from the network if the network is there — it is what people
  // are told to open when the cache itself is the problem. The build stamp likewise: a cached
  // answer to "what is deployed?" is an answer about the past, which is the one thing it must
  // never be.
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
          return await fetch(request);
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
          const fresh = await fetch(request);
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
      const response = await fetch(request);
      // Opaque and error responses are not worth keeping; a cached failure is a failure that
      // repeats even after the problem is fixed.
      if (response.ok && response.type === "basic") {
        cache.put(request, response.clone());
      }
      return response;
    })(),
  );
});
