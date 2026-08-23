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

import { execFileSync } from "node:child_process";
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

// Every request this page makes, so the check below can say where the bytes came from.
const fetched = [];
page.on("request", (request) => fetched.push(request.url()));

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

// Nothing comes from anybody else.
//
// Flutter's default is to load its ~7MB engine from gstatic.com. That means a network which cannot
// reach Google cannot start this app at all; the largest asset in the product never travels over
// MultiPath's lines, which is the whole point of having them; and our own worker cannot cache it,
// because a cross-origin response is opaque. `--no-web-resources-cdn` puts the engine beside
// everything else — and this check is what stops the flag going missing again, because losing it
// looks like nothing at all from a machine that can reach Google.
// A probe to the registry's other line is the one thing that is SUPPOSED to leave this origin —
// that is what a second line is. It is exempt by path, not by host, so an asset served from
// somewhere else still fails this.
const foreign = fetched.filter(
  (url) =>
    !url.startsWith(BASE) &&
    !url.startsWith("data:") &&
    new URL(url).pathname !== "/mt/probe",
);
check(
  "every byte comes from this origin",
  foreign.length === 0,
  foreign.slice(0, 2).join(" ") || "none",
);

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

// The thing a person actually does, in a real browser, against the real release build: open a
// conversation, type, press send.
//
// This exists because "the send button does nothing" survived every unit test we had — and it did
// so for a reason no unit test could have caught. The outbox minted its idempotency key with
// `Random.nextInt(1 << 32)`, and dart2js compiles `<<` to JavaScript's 32-bit shift, where shifting
// by 32 shifts by 0: the bound was 4294967296 in a test and 0 in a browser, nextInt(0) threw, and
// the throw came out of the enqueue that the button calls. Every test passed; the button did
// nothing. Only something that drives the compiled app in a browser can see that class of bug.
const chat = await context.newPage();
const chatErrors = [];
chat.on("pageerror", (e) => chatErrors.push(`pageerror: ${e.message ?? e}`));
chat.on("console", (m) => {
  if (m.type() === "error") chatErrors.push(`console: ${m.text()}`);
});
const sent = [];
chat.on("request", (r) => {
  if (r.method() === "POST" && r.url().includes("/mt/chat/")) sent.push(r.url());
});

await chat.goto(BASE + "/chats/5", { waitUntil: "load" });
await chat
  .waitForFunction(() => document.documentElement.dataset.mtReady === "1", null, {
    timeout: 60000,
  })
  .catch(() => {});

// Flutter draws into a canvas: there is nothing to select or click by text, so this clicks where a
// person would. In a wide window the conversation is the right-hand pane and its composer sits at
// the bottom of it: the field across the middle, the send button just inside the right edge.
const size = chat.viewportSize() ?? { width: 1280, height: 720 };
await chat.mouse.click(size.width * 0.6, size.height - 32);
await chat.keyboard.type("probe message");
await chat.waitForTimeout(300);
await chat.mouse.click(size.width - 100, size.height - 32);
await chat.waitForTimeout(1500);

check(
  "a message typed into a conversation is posted",
  sent.length > 0,
  sent.join(" ") || chatErrors.slice(0, 2).join(" | "),
);
await chat.close();

// A deploy has to be visible on the visit it lands on, not the one after.
//
// The worker answers the application's own code from the network first, because those file names
// never change: `main.dart.js` is called that in every build there will ever be. Cache-first on it
// means the page you are looking at was assembled from the old cache while the new worker was
// still installing — "one reload behind" and "not deployed" look identical from a chair.
const revisit = await context.newPage();
const codeRequests = [];
revisit.on("request", (r) => {
  const path = new URL(r.url()).pathname;
  if (path === "/main.dart.js" || path === "/flutter_bootstrap.js") {
    codeRequests.push(path);
  }
});
await revisit.goto(BASE + "/", { waitUntil: "load" });
await revisit
  .waitForFunction(() => document.documentElement.dataset.mtReady === "1", null, {
    timeout: 60000,
  })
  .catch(() => {});
check(
  "a second visit still asks the server for the app's own code",
  codeRequests.includes("/main.dart.js"),
  codeRequests.join(" ") || "none",
);

// …and asks for nothing else. The engine is 5MB of wasm and the fonts are another megabyte; if a
// warm visit pulls those again, the cache is not doing the one job it exists for. This is the
// assertion that would catch a version stamp that disagrees with itself, since a mismatch makes the
// worker throw its cache away on every single navigation — which looks like nothing at all except
// in the bytes.
const heavy = await revisit.evaluate(() =>
  performance
    .getEntriesByType("resource")
    .filter((entry) => /canvaskit|\.ttf|\.otf/.test(entry.name))
    .map((entry) => ({ name: new URL(entry.name).pathname, transferred: entry.transferSize })),
);
const downloaded = heavy.filter((entry) => entry.transferred > 0);
check(
  "and downloads the engine and the fonts from its cache, not the network",
  heavy.length > 0 && downloaded.length === 0,
  downloaded.map((e) => `${e.name}:${e.transferred}`).join(" ") ||
    `${heavy.length} from cache`,
);
await revisit.close();

// Measuring, not just routing. Every line but the one real traffic happened to use sat at "never
// measured" in production for weeks, and nothing here could see it: the fake registry had a single
// line, and with one line a client that measures and a client that does not look identical.
{
  const probes = new Set();
  const probePage = await context.newPage();
  probePage.on("request", (r) => {
    const url = new URL(r.url());
    if (url.pathname === "/mt/probe") probes.add(url.origin);
  });
  await probePage.goto(BASE + "/", { waitUntil: "load" });
  await probePage.waitForFunction(() => document.documentElement.dataset.mtReady === "1", null, {
    timeout: 30000,
  });
  // The registry has to arrive before measuring starts, so this is a wait, not an instant.
  await probePage
    .waitForRequest((r) => new URL(r.url()).pathname === "/mt/probe", { timeout: 20000 })
    .catch(() => {});
  await probePage.waitForTimeout(2000);
  // Both lines, not just the near one: the registry's second line is a different origin, so a
  // client that only ever measured the one it was served from would show exactly one here.
  check("every line in the registry is actually probed", probes.size >= 2, [...probes].join(" "));
  await probePage.close();
}

// A deploy, on top of a browser that is already running the build before it.
//
// This is the shape of the worst failure this client has had: reach 100%, then never paint. The
// application's own code is network-first, so a reload right after a deploy gets the NEW
// main.dart.js — while the engine beside it is cache-first and comes back from the cache, which
// still holds the PREVIOUS build's canvaskit. A new app on an old engine does not start, and the
// build.json reconcile cannot save it because it is throttled to a minute and a deploy plus a
// reload fits inside one.
if (process.env.CHECK_WEB_DEPLOY_BASE && process.env.CHECK_WEB_DEPLOY_DIR) {
  const DEPLOY = process.env.CHECK_WEB_DEPLOY_BASE;
  const marker = `deployed-${Date.now()}`;
  const deployContext = await browser.newContext();
  const deployPage = await deployContext.newPage();
  const deployErrors = [];
  deployPage.on("pageerror", (e) => deployErrors.push(String(e)));

  const ready = () =>
    deployPage
      .waitForFunction(() => document.documentElement.dataset.mtReady === "1", null, {
        timeout: 40000,
      })
      .then(() => true)
      .catch(() => false);

  // A deep link, because that is where it was seen — and because a route other than "/" is the
  // one the worker answers from its own precache rather than from the server.
  await deployPage.goto(DEPLOY + "/chats/206", { waitUntil: "load" });
  check("a deep link starts the app before the deploy", await ready());

  execFileSync("node", [
    new URL("fake-deploy.mjs", import.meta.url).pathname,
    process.env.CHECK_WEB_DEPLOY_DIR,
    marker,
  ]);

  await deployPage.reload({ waitUntil: "commit" });
  const started = await ready();
  check("and starts again on the reload right after a deploy", started);

  // The point of the check, not a detail of it: whatever the page is running, the engine it got
  // must belong to the same build as the code.
  const engine = await deployPage.evaluate(async (needle) => {
    const response = await fetch("/canvaskit/chromium/canvaskit.js");
    return (await response.text()).includes(needle);
  }, marker);
  check("with the engine from the build that was just deployed, not the one before it", engine);
  check("and no page errors while it started", deployErrors.length === 0, deployErrors[0] ?? "");
  await deployContext.close();
}

// Back is a pop on the display tree, and at the root of a section there is nothing left to pop.
//
// The browser's history is a record of where you have BEEN, which is a different thing. Every tab
// switch used to leave an entry in it, so back at the root of a section walked backwards through
// the afternoon — into the section you had been in two taps ago — which is not what back meant one
// press earlier. Moves that do not stack anything on anything now leave no entry, so the entries
// behind the app are the ones from before the app, and back at the root leaves for them.
{
  const backPage = await context.newPage();
  await backPage.goto(BASE + "/chats", { waitUntil: "load" });
  await backPage.waitForFunction(() => document.documentElement.dataset.mtReady === "1", null, {
    timeout: 30000,
  });
  await backPage.waitForTimeout(1200);
  const before = await backPage.evaluate(() => history.length);

  // The rail, tapped where a person taps it: docs, then agents.
  for (const y of [78, 124]) {
    await backPage.mouse.click(31, y);
    await backPage.waitForTimeout(600);
  }
  const after = await backPage.evaluate(() => history.length);
  const where = new URL(backPage.url()).pathname;
  check(
    "switching sections leaves nothing behind for back to walk into",
    after === before && where !== "/chats",
    `${before} then ${after}, at ${where}`,
  );

  await backPage.goBack({ waitUntil: "commit" }).catch(() => {});
  await backPage.waitForTimeout(800);
  check(
    "so back at the root of a section leaves the app, rather than going somewhere inside it",
    !backPage.url().startsWith(BASE),
    backPage.url(),
  );
  await backPage.close();
}

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED` : "\nall checks passed");
process.exit(failures.length ? 1 : 0);
