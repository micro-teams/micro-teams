/*
 * The web client's service worker: keeps the app on the device, and fetches what the browser
 * itself asks for over the substrate.
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
 * How it fetches. The page dials the substrate for its own requests, but the document, the scripts,
 * the fonts and the images are fetched by the browser, and a service worker is the only place they
 * can be intercepted. Here they go over multipath's line router: it dials at once over this origin
 * and the lines kept from last time, asks /mt/lines for the current ones in the background, and
 * adds each new one to the dial in progress; it falls back to the network when no line is up within
 * three seconds or the substrate failed a request. The list it keeps outlives builds. Install
 * fetches the document over the router, so the lines are being dialled while the worker activates.
 * Whatever fails in here — the router itself, the cache — ends in the request being sent directly,
 * logged and counted, never in a failed answer the network could have given.
 *
 * What it says about itself: a message { type: "stats" } is answered, on the port it came with,
 * with { build, lines, routed, direct } — the build, the lines known, and how many requests went
 * over the substrate and how many to the network. The lines panel and the web journey ask.
 *
 * What it leaves alone: anything but GET, other origins, /api/ and /mt/ (the page carries those
 * over its own substrate, and an API answer must never come from a cache), /downloads/ (installers
 * are not part of the app), /version and unregister.html (the way out must come from the network).
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

const asWebSocket = (origin: string) => origin.replace(/^http/, "ws");
const counts = { routed: 0, direct: 0 };

const router = createLineRouter({
  seed: [asWebSocket(self.location.origin)],
  store: cacheLineStore(LINES, new URL("__lines", self.location.href).href),
  discover: async () => {
    const res = await fetch("/mt/lines", { cache: "no-store" });
    if (!res.ok) throw new Error(`/mt/lines answered ${res.status}`);
    const body = (await res.json()) as { lines?: { url?: string }[] };
    return (body.lines ?? []).flatMap((l) => {
      try {
        return [asWebSocket(l.url ? new URL(l.url).origin : self.location.origin)];
      } catch {
        return []; // a malformed entry costs redundancy, never the app
      }
    });
  },
  fallbackAfterMs: 3000,
  // As the page's substrate (src/transport/substrate.ts): a dead line noticed and replaced in
  // seconds. The bound on a request is on its whole answer, and the first screen's script is
  // megabytes: 15 s carries it over a line of a few Mbit/s, where 2.5 s would send it directly
  // after most of it had arrived.
  pingIntervalMs: 2000,
  deadAfterMs: 5000,
  maxDelayMs: 2000,
  requestTimeoutMs: 15000,
  fallback: (request) => {
    counts.direct += 1;
    return fetch(request);
  },
  onLines: (lines) => console.log(`sw: lines ${lines.join(", ")}`),
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
  return p.startsWith("/api/") || p.startsWith("/mt/") || p.startsWith("/downloads/") || p === "/version" || p === `${BASE}unregister.html`;
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
  event.ports[0]?.postMessage({ build: __MT_BUILD__, lines: router.lines(), ...counts });
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
