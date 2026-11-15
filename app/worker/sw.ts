/*
 * The web client's service worker: keeps the app on the device, and fetches what the browser
 * itself asks for over the substrate.
 *
 * Built by tool/build-worker.mjs into the web bundle as sw.js, with BUILD (a hash of the files it
 * precaches) and SHELL (those files, relative to where the worker is) filled in; registered by
 * src/platform/worker.web.ts.
 *
 * What it keeps. The document, the entry script, its stylesheets, the favicon and the manifest are
 * precached on install, because nothing starts without them; everything else is cached as it is
 * fetched. The document is asked for first and answered from the cache only when that fails, because its name
 * never changes and a cached copy of it would hide a deploy; everything else carries a content hash
 * in its name and is answered from the cache first. A new build is a new cache, and the old one is
 * deleted when the new worker activates — which, without skipWaiting, is only once no page is using
 * the old one, so nothing mid-load loses the files it was loading.
 *
 * How it fetches. The page dials the substrate for its own requests, but the document, the scripts,
 * the fonts and the images are fetched by the browser, and a service worker is the only place they
 * can be intercepted. Here they go over multipath's line router: it dials at once over this origin
 * and the lines kept from last time, asks /mt/lines for the current ones in the background, and
 * adds each new one to the dial in progress; it falls back to the network when no line is up within
 * three seconds or the substrate failed a request. The list it keeps outlives builds.
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
declare const __MT_SHELL__: string[];

const BASE = new URL("./", self.location.href).pathname;
const CACHE = `microteams-${__MT_BUILD__}`;
const LINES = "microteams-lines";
const DOCUMENT = [BASE, `${BASE}index.html`];
const SHELL = __MT_SHELL__.map((f) => `${BASE}${f}`);

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
      const cache = await caches.open(CACHE);
      // One at a time rather than addAll: one missing file must not leave the app with no worker.
      await Promise.all(
        SHELL.map(async (url) => {
          try {
            await cache.add(new Request(url, { cache: "reload" }));
          } catch (e) {
            console.warn(`sw: could not precache ${url}: ${String(e)}`);
          }
        }),
      );
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

async function routed(request: Request): Promise<Response> {
  const before = counts.direct;
  const response = await router.fetch(request);
  if (counts.direct === before) counts.routed += 1;
  return response;
}

self.addEventListener("message", (event) => {
  if ((event.data as { type?: string } | null)?.type !== "stats") return;
  event.ports[0]?.postMessage({ build: __MT_BUILD__, lines: router.lines(), ...counts });
});

async function networkFirst(request: Request, fallbackKey?: string): Promise<Response> {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await routed(request);
    if (worthCaching(fresh)) await cache.put(fallbackKey ?? request, fresh.clone());
    return fresh;
  } catch {
    return (await cache.match(fallbackKey ?? request)) ?? (await cache.match(BASE)) ?? Response.error();
  }
}

async function cacheFirst(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await routed(request);
  if (worthCaching(response)) await cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (leftAlone(request)) return;
  const path = new URL(request.url).pathname;
  // A navigation to any route under the app is answered with the document — the worker's half of
  // nginx's try_files, so a reload on any screen works offline too.
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, `${BASE}index.html`));
  } else if (DOCUMENT.includes(path) || path === `${BASE}sw.js`) {
    event.respondWith(networkFirst(request));
  } else {
    event.respondWith(cacheFirst(request));
  }
});
