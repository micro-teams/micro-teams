/*
 * The web client's service worker: keeps the app on the device, and fetches what the browser
 * itself asks for over the lines.
 *
 * Built by tool/build-worker.mjs into the web bundle as sw.js, with BUILD (the build's version)
 * filled in; registered by the loader (worker/loader.js), which on a first visit waits for it to
 * take the page and then downloads the first screen's files through it.
 *
 * What it keeps. The document is precached on install, so the app opens offline after one visit;
 * everything else is cached as it is fetched, the loader's downloads included, into the same cache
 * the loader fills. Install fetches nothing more, because what it fetched would be fetched a second
 * time by the loader, and the loader is waiting for this worker to activate. The document is asked
 * for first and answered from the cache only when that fails, because its name never changes and a
 * cached copy of it would hide a deploy; everything else carries a content hash in its name and is
 * answered from the cache first. A new build is a new cache, and the old one is deleted when the
 * new worker activates — which, without skipWaiting, is only once no page is using the old one, so
 * nothing mid-load loses the files it was loading.
 *
 * How it fetches. The page holds its own MultiPath client for its own requests, but the document,
 * the scripts, the fonts and the images are fetched by the browser, and a service worker is the
 * only place they can be intercepted. Here they go over multipath's line router: its client dials
 * at once over the lines kept from last time (the Cache Storage cache microteams-lines, which
 * outlives builds), while the origin's current list (/multipath/v3/lines) is fetched and replaces
 * it. A request goes to the network instead, logged with its reason and counted, when no session
 * is live within three seconds of the worker's start, or, for a GET, when the lines fail it or have
 * not begun to answer within 15 s (the first screen's script is megabytes). Install fetches the
 * document over the router, so the lines are being dialled while the worker activates. Whatever
 * fails in here — the router itself, the cache — ends in the request being sent directly, logged
 * and counted, never in a failed answer the network could have given.
 *
 * Integrity. A file whose name carries its content's hash is checked against it as it streams in,
 * and one that does not match is not kept and is fetched from the network from then on: the fonts
 * the build moved under _expo/static/fonts/ carry a SHA-256 prefix (tool/build-worker.mjs), every
 * other script, stylesheet and asset of the export an MD5 one (Expo's own naming). A name with an @
 * (a scaled image, @2x) is left out: Expo names those after the hash of all of an image's scales
 * together, not of the file.
 *
 * What it says about itself: a message { type: "stats" } is answered, on the port it came with,
 * with { build, routed, direct, fallbacks, client } — the build, how many requests went over the
 * lines and how many to the network, the last fallbacks with their reasons, and the router's
 * client stats (session, lines, streams). The lines panel and the web journey ask.
 *
 * What it leaves alone: anything but GET, other origins, /api/ and /mt/ (the page carries those
 * over its own client, and an API answer must never come from a cache), /multipath/ (the line list
 * the page's client fetches must be the origin's current one), /downloads/ (installers are not part
 * of the app), /version and unregister.html (the way out must come from the network).
 */
import { cacheLineStore, createLineRouter } from "@micro-teams/multipath";

declare const self: ServiceWorkerGlobalScope;
declare const __MT_BUILD__: string;

const BASE = new URL("./", self.location.href).pathname;
const CACHE = `microteams-${__MT_BUILD__}`;
const LINES = "microteams-lines";
// Asked for first, always: the document and the manifest name the build, and a cached copy of
// either would hide a deploy.
const DOCUMENT = [BASE, `${BASE}index.html`, `${BASE}files.json`];

const counts = { routed: 0, direct: 0 };
const fallbacks: { at: string; url: string; reason: string }[] = [];

const router = createLineRouter({
  entry: self.location.origin,
  store: cacheLineStore(LINES, new URL("__lines", self.location.href).href),
  fallbackAfterMs: 3000,
  requestTimeoutMs: 15000,
  integrity: [
    { pattern: /\/_expo\/static\/fonts\/[^/@]+\.([0-9a-f]{32})\.\w+$/, algorithm: "SHA-256" },
    { pattern: /\/_expo\/static\/(?:js|css|assets)\/(?:[^/]+\/)*[^/@]+[-.]([0-9a-f]{32})\.\w+$/, algorithm: "MD5" },
  ],
  fallback: (request) => {
    counts.direct += 1;
    return fetch(request);
  },
  onEvent: (e) => {
    if (e.type !== "fallback") return;
    fallbacks.push({ at: new Date().toISOString(), url: e.url, reason: e.reason });
    fallbacks.splice(0, fallbacks.length - 20);
  },
  log: (m) => console.warn(`sw: ${m}`),
});

/** Worth keeping: a whole, successful answer. A cached failure repeats after the cause is fixed. */
const worthCaching = (r: Response) => r.ok && r.status === 200 && (r.type === "basic" || r.type === "default");

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const url = `${BASE}index.html`;
      try {
        const response = await routed(new Request(url, { cache: "reload" }));
        if (!worthCaching(response)) throw new Error(`answered ${response.status}`);
        await (await caches.open(CACHE)).put(url, response);
      } catch (e) {
        // The worker is still worth having without it: the next visit's navigation caches it.
        console.warn(`sw: could not precache ${url}: ${String(e)}`);
      }
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith("microteams-") && name !== CACHE && name !== LINES) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

function leftAlone(request: Request): boolean {
  if (request.method !== "GET") return true;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return true;
  const p = url.pathname;
  return (
    p.startsWith("/api/") ||
    p.startsWith("/mt/") ||
    p.startsWith("/multipath/") ||
    p.startsWith("/downloads/") ||
    p === "/version" ||
    p === `${BASE}unregister.html`
  );
}

/** Over the line router; directly, logged and counted, when the router itself fails. */
async function routed(request: Request): Promise<Response> {
  const before = counts.direct;
  let response: Response;
  try {
    response = await router.fetch(request);
  } catch (e) {
    console.warn(`sw: the line router failed on ${request.url} (${String(e)}); sending it directly`);
    counts.direct += 1;
    return fetch(request);
  }
  if (counts.direct === before) counts.routed += 1;
  return response;
}

/** Keeps an answer; a cache that refuses it costs the copy, never the answer. */
async function keep(key: Request | string, response: Response): Promise<void> {
  try {
    await (await caches.open(CACHE)).put(key, response);
  } catch (e) {
    console.warn(`sw: could not cache ${typeof key === "string" ? key : key.url}: ${String(e)}`);
  }
}

self.addEventListener("message", (event) => {
  if ((event.data as { type?: string } | null)?.type !== "stats") return;
  event.ports[0]?.postMessage({ build: __MT_BUILD__, ...counts, fallbacks, client: router.stats() });
});

async function networkFirst(request: Request, fallbackKey?: string): Promise<Response> {
  let fresh: Response;
  try {
    fresh = await routed(request);
  } catch {
    const cache = await caches.open(CACHE);
    return (await cache.match(fallbackKey ?? request)) ?? (await cache.match(BASE)) ?? Response.error();
  }
  if (worthCaching(fresh)) await keep(fallbackKey ?? request, fresh.clone());
  return fresh;
}

async function cacheFirst(request: Request): Promise<Response> {
  const hit = await (await caches.open(CACHE)).match(request);
  if (hit) return hit;
  const response = await routed(request);
  if (worthCaching(response)) await keep(request, response.clone());
  return response;
}

/** The answer, or — when this worker fails before having one — the network's, logged. */
function answer(request: Request, work: Promise<Response>): Promise<Response> {
  return work.catch((e: unknown) => {
    console.warn(`sw: failed on ${request.url} (${String(e)}); sending it directly`);
    return fetch(request);
  });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (leftAlone(request)) return;
  const path = new URL(request.url).pathname;
  // A navigation to any route under the app is answered with the document — the worker's half of
  // nginx's try_files, so a reload on any screen works offline too.
  if (request.mode === "navigate") {
    event.respondWith(answer(request, networkFirst(request, `${BASE}index.html`)));
  } else if (DOCUMENT.includes(path) || path === `${BASE}sw.js`) {
    event.respondWith(answer(request, networkFirst(request)));
  } else {
    event.respondWith(answer(request, cacheFirst(request)));
  }
});
