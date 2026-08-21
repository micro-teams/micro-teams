/*
 *  Description: The web build, in a real browser.
 *
 *               Everything here is browser behaviour, and none of it can be asserted any other
 *               way: whether the app actually paints, whether the service worker registers and
 *               stores anything, whether a second visit works with the network off, and whether
 *               the escape hatch clears it all again. The first version of the React build passed
 *               every unit test and did not start offline, which is why this file's ancestor was
 *               written; the same risk exists here, only now the renderer is a canvas.
 *
 *               "Did the app start?" is deliberately NOT asked of the DOM structure. Flutter draws
 *               into a canvas, so a <canvas> element exists whether or not a single frame was ever
 *               produced. The app marks the document itself after its first frame — see
 *               lib/src/core/ready_signal.dart — and that mark is what this reads.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 */

import { chromium } from "playwright";

const BASE = process.env.CHECK_WEB_BASE ?? "http://127.0.0.1:8931";

const failures = [];
function check(what, ok, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures.push(what);
}

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});

// Recorded from before the first byte of the document runs, because the thing being measured
// happens during the load: by the time a test could attach a listener, the launcher is done.
await page.addInitScript(() => {
  window.__mpProgress = [];
  window.addEventListener("multipath:progress", (e) => window.__mpProgress.push(e.detail.percent));
});

await page.goto(BASE + "/", { waitUntil: "load" });

// The first document is the multipath launcher, not Flutter's: that request is the one thing that
// cannot be spread across lines, so it is small and does one job. Flutter's document is kept as
// /app.html.
const launcher = await page.evaluate(() => ({
  splash: Boolean(document.querySelector("[data-multipath-progress]")),
  config: Boolean(window.__multipath__ && window.__multipath__.registry),
}));
check("the launcher is what the browser was served", launcher.splash && launcher.config);

// Waited for, not sampled: the engine has to download, boot and lay out before anything is on
// screen, and reading the moment "load" fires measures this script's patience rather than the app.
const painted = await page
  .waitForFunction(() => document.documentElement.dataset.mtReady === "1", null, {
    timeout: 60000,
  })
  .then(() => true)
  .catch(() => false);
check("the app paints a first frame", painted);

// A percentage of the 13KB bootstrap would be a lie told quickly. What is counted is main.dart.js,
// which is 3.4MB and is what the visitor is actually waiting for.
const progress = await page.evaluate(() => window.__mpProgress ?? []);
check("the launcher reported progress while loading", progress.length > 1, progress.join(" "));
check(
  "and it got to 100 only once the app had been imported",
  progress[progress.length - 1] === 100 && progress.every((p, i) => i === 0 || p >= progress[i - 1]),
  progress.slice(-3).join(" "),
);

// The splash covers the whole viewport, so a splash that stays is a black screen over a running
// app. It goes when the app says it has painted, not when the module finished importing.
// Waited for rather than sampled: it fades, so reading it the instant the first frame lands
// measures the transition rather than the rule.
const splashGone = await page
  .waitForFunction(
    () => {
      const el = document.querySelector("#mt-splash");
      return !el || Number(getComputedStyle(el).opacity) === 0;
    },
    null,
    { timeout: 5000 },
  )
  .then(() => true)
  .catch(() => false);
check("the splash gets out of the way once the app has painted", splashGone);

// Flutter's own document still starts the app, which is what /unregister.html sends people to and
// the quickest way to tell whether the launcher is what is wrong.
const plain = await context.newPage();
await plain.goto(BASE + "/app.html", { waitUntil: "load" });
const plainPainted = await plain
  .waitForFunction(() => document.documentElement.dataset.mtReady === "1", null, { timeout: 60000 })
  .then(() => true)
  .catch(() => false);
check("the app also starts without the launcher, from /app.html", plainPainted);
await plain.close();

check(
  "the tab is named",
  (await page.title()) === "MicroTeams",
  await page.title(),
);

const registered = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  return Boolean(reg);
});
check("a service worker registers", registered);

await page
  .waitForFunction(async () => (await caches.keys()).length > 0, null, { timeout: 30000 })
  .catch(() => {});
const cacheNames = await page.evaluate(() => caches.keys());
check("it stores something", cacheNames.length > 0, cacheNames.join(", "));

// Flutter's own worker must be gone, not merely unused: two workers in a bundle is how someone
// later spends an afternoon debugging the wrong file. tool/make-sw.mjs deletes it.
//
// Note the shape of this assertion: under an SPA fallback a MISSING file is answered with
// index.html and a 200, so "not 404" proves nothing. What proves it is that the answer is the
// document rather than JavaScript. The same trap makes a genuinely missing asset show up as a
// syntax error in the console instead of a 404, which is worth knowing before debugging one.
const flutterSw = await page.evaluate(async () => {
  const res = await fetch("/flutter_service_worker.js");
  return res.headers.get("content-type") ?? "";
});
check(
  "Flutter's deprecated worker is not shipped",
  flutterSw.startsWith("text/html"),
  flutterSw,
);

// The worker and the files have to be from the same build, or a deploy lands invisibly: the worker
// is only replaced when its own bytes change, so an old worker keeps serving an old app out of its
// own cache no matter what was uploaded beside it.
const stamped = await page.evaluate(async () => {
  const [sw, build] = await Promise.all([
    fetch("/sw.js").then((r) => r.text()),
    fetch("/build.json").then((r) => r.json()),
  ]);
  return {
    worker: /const VERSION = "([^"]+)"/.exec(sw)?.[1] ?? null,
    build: build.version ?? null,
  };
});
check(
  "the worker and the build stamp agree",
  stamped.worker != null && stamped.worker === stamped.build,
  `worker ${stamped.worker}, stamp ${stamped.build}`,
);

const manifest = await page.evaluate(async () => {
  const link = document.querySelector('link[rel="manifest"]');
  if (!link) return null;
  const res = await fetch(link.href);
  if (!res.ok) return null;
  return res.json();
});
check("the web app manifest is served", manifest !== null);
check(
  "it is this app, not the framework's placeholder",
  manifest?.name === "MicroTeams",
  manifest?.name,
);

const missingIcons = await page.evaluate(async (icons) => {
  const bad = [];
  for (const src of icons) {
    const res = await fetch(src, { method: "GET" });
    if (!res.ok) bad.push(`${src} -> ${res.status}`);
  }
  return bad;
}, (manifest?.icons ?? []).map((i) => i.src));
check("every declared icon is actually served", missingIcons.length === 0, missingIcons.join(", "));

// A URL is an address: /chats/206 has to be openable, not just reachable by tapping. This is the
// SPA fallback in nginx.conf — and the thing a plain static file server does NOT do, which is worth
// knowing before someone concludes routing is broken.
const deep = await context.newPage();
const deepResponse = await deep.goto(BASE + "/agents", { waitUntil: "load" });
const deepPainted = await deep
  .waitForFunction(() => document.documentElement.dataset.mtReady === "1", null, { timeout: 60000 })
  .then(() => true)
  .catch(() => false);
check(
  "a deep link is served the app rather than a 404",
  deepResponse?.status() === 200 && deepPainted,
  `${deepResponse?.status()}`,
);
// And that it OPENS that route. Serving the document is only half of it: Flutter web defaults to
// hash routing, where /agents paints the app and then quietly becomes /#/chats — the link works
// and takes you somewhere else, which is worse than a 404 because nothing looks broken.
const landedOn = await deep.evaluate(() => location.pathname + location.hash);
check("and it opens that route, not the default one", landedOn === "/agents", landedOn);
await deep.close();

// The engine is megabytes of wasm, and it is fetched before the worker takes over — so this is a
// claim about the SECOND visit, which is the only visit it can be about. A first visit always
// needs the network; what has to be true is that a second one does not.
const second = await context.newPage();
await second.goto(BASE + "/", { waitUntil: "load" });
await second
  .waitForFunction(() => document.documentElement.dataset.mtReady === "1", null, { timeout: 60000 })
  .catch(() => {});
const cachedEngine = await second.evaluate(async () => {
  for (const name of await caches.keys()) {
    const cache = await caches.open(name);
    const keys = await cache.keys();
    if (keys.some((r) => /main\.dart\.js|canvaskit|skwasm/.test(new URL(r.url).pathname))) {
      return true;
    }
  }
  return false;
});
check("after a second visit the engine is cached, not just the shell", cachedEngine);
await second.close();

// The claim the whole precache exists for: it starts with no network at all.
await context.setOffline(true);
const offline = await context.newPage();
const offlineErrors = [];
offline.on("pageerror", (e) => offlineErrors.push(String(e)));
const offlineResponse = await offline
  .goto(BASE + "/", { waitUntil: "load" })
  .catch((e) => {
    offlineErrors.push(String(e));
    return null;
  });
check(
  "the document itself came from the cache",
  offlineResponse?.status() === 200,
  String(offlineResponse?.status()),
);
const offlinePainted = await offline
  .waitForFunction(() => document.documentElement.dataset.mtReady === "1", null, { timeout: 60000 })
  .then(() => true)
  .catch(() => false);
check("the app starts offline, from the cache", offlinePainted, offlineErrors.slice(0, 2).join(" | "));
await offline.close();
await context.setOffline(false);

// And the way out. A cached app that will not update is the worst failure a service worker has,
// and this is the answer that can be given over the phone.
const reset = await context.newPage();
await reset.goto(BASE + "/unregister.html");
await reset.waitForSelector("[data-unregister-done]", { timeout: 15000 }).catch(() => {});
const after = await reset.evaluate(async () => ({
  workers: (await navigator.serviceWorker.getRegistrations()).length,
  caches: (await caches.keys()).length,
}));
check("the escape hatch unregisters the worker", after.workers === 0, JSON.stringify(after));
check("the escape hatch clears the caches", after.caches === 0, JSON.stringify(after));

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED` : "\nall checks passed");
process.exit(failures.length ? 1 : 0);
