/*
 *  Description: The shipped bundle, behind the shipped gateway, in a real browser.
 *
 *               tool/check-web.mjs asks whether the app works. This asks the question that one
 *               structurally cannot: whether the app works WHERE IT IS ACTUALLY SERVED. Those were
 *               the same question for as long as the app was the root of the deployment. They
 *               stopped being the same question the day a marketing site took "/" and the app moved
 *               under "/app/", and the gap between them is exactly T-093: every HTTP status from
 *               the new nginx was correct — verified, by hand, on both :80 and :443 — and the app
 *               still opened onto go_router's "no routes for location: /app" error page, because
 *               where a Flutter document thinks it is comes from its <base href>, which nginx has
 *               no opinion about.
 *
 *               Two things follow from that, and they are why this file is shaped the way it is.
 *
 *               First: nothing here is a stand-in. The gateway is deploy/nginx.conf itself, in the
 *               nginx image, and the tree behind it is the one tool/assemble-dist.mjs hands the
 *               release workflow. A hand-written server that "behaves like nginx" is how you test
 *               your own idea of the deployment instead of the deployment.
 *
 *               Second: the failure was SILENT. go_router catches a routing failure and renders its
 *               own error page, so there was no page error, no console error and no bad status —
 *               and the app paints a first frame either way, so the ready signal was green too.
 *               Nothing this suite could have inherited from check-web.mjs would have caught it. So
 *               the assertions here are about where the app ARRIVED: the URL it settles on, and the
 *               call it makes to the backend once it is there. A canvas cannot be queried, but an
 *               app that reached its chats screen asked the server for chats, and one sitting on an
 *               error page did not.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 */

import { execFileSync } from "node:child_process";
import { chromium } from "playwright";

const BASE = process.env.CHECK_BUNDLE_BASE ?? "http://127.0.0.1:58090";

const failures = [];
function check(what, ok, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures.push(what);
}

/** The app dials MultiPath at /mt/link; the fake upstreams do not speak it. Expected, not a bug. */
const isExpectedNoise = (text) =>
  (text.includes("WebSocket") && (text.includes("/mt/link") || text.includes("/mt/updates"))) ||
  (text.includes("Failed to load resource") && text.includes("404"));

const browser = await chromium.launch();

/** Opens a page, waits for the app to settle, and reports where it ended up and what it asked for. */
async function openApp(url, { waitForUrl } = {}) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  const calls = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && !isExpectedNoise(m.text())) errors.push(m.text());
  });
  page.on("request", (r) => calls.push(new URL(r.url()).pathname));

  const response = await page.goto(url, { waitUntil: "load" });
  const painted = await page
    .waitForFunction(() => document.documentElement.dataset.mtReady === "1", null, { timeout: 90000 })
    .then(() => true)
    .catch(() => false);
  // The router settles a frame or two after the first one: the initial location is matched, the
  // redirect runs, and only then is the address bar rewritten. Waiting for the expected URL rather
  // than sleeping keeps a slow CI machine from reading as a routing failure.
  if (waitForUrl) {
    await page.waitForURL(waitForUrl, { timeout: 20000 }).catch(() => {});
  }
  // …and the backend call the destination screen makes is likewise not instant.
  await page.waitForTimeout(2000);

  const result = { status: response?.status(), painted, url: page.url(), errors, calls };
  await context.close();
  return result;
}

// ── The marketing site has "/" ────────────────────────────────────────────────────────────────
{
  const context = await browser.newContext();
  const page = await context.newPage();
  const response = await page.goto(BASE + "/", { waitUntil: "load" });
  check("the marketing site answers /", response?.status() === 200, String(response?.status()));
  const heading = await page.textContent("h1").catch(() => null);
  check(
    "and it is the site's own document, not the app's",
    Boolean(heading && heading.includes("MicroTeams")),
    heading ?? "no <h1>",
  );

  // The one link that has to be right, because it is how every visitor reaches the product.
  const login = await page.getAttribute("#login-link", "href").catch(() => null);
  check("its log-in link points at the app", login === "/app/", String(login));

  for (const page_ of ["terms.html", "privacy.html", "contact.html", "about.html"]) {
    const res = await page.goto(`${BASE}/${page_}`, { waitUntil: "load" });
    check(`the site serves ${page_}`, res?.status() === 200, String(res?.status()));
  }

  // No SPA fallback at the root: the site is not client-routed, so an unknown path there is a
  // genuine 404 rather than a document that boots an application nobody asked for.
  const missing = await page.goto(BASE + "/no-such-page", { waitUntil: "load" });
  check("an unknown path at the root is a real 404", missing?.status() === 404, String(missing?.status()));
  await context.close();
}

// ── The app has "/app/" ───────────────────────────────────────────────────────────────────────
//
// This is the T-093 assertion. Opening /app/ signed in has to END somewhere real: go_router's
// initialLocation is /chats, and reaching it rewrites the address bar to /app/chats. Before the
// fix this stayed at /app/ forever with an error page on the canvas — painted, no errors, wrong.
{
  const app = await openApp(BASE + "/app/", { waitForUrl: "**/app/chats" });
  check("the app answers /app/", app.status === 200, String(app.status));
  check("the app paints a first frame", app.painted);
  check(
    "and it routes: /app/ settles on the app's own first screen",
    app.url === BASE + "/app/chats",
    app.url,
  );
  check(
    "and it really got there — it asked the backend for chats",
    app.calls.includes("/mt/chat"),
    app.calls.filter((p) => p.startsWith("/mt/")).join(" ") || "no /mt/ calls at all",
  );
  check("no page errors", app.errors.length === 0, app.errors.slice(0, 3).join(" | "));
}

// ── A deep link under /app/ ───────────────────────────────────────────────────────────────────
//
// nginx falls an unknown path under /app/ back to /app/index.html, and the app is then responsible
// for reading the route out of the URL it was opened at. Both halves have to work: the fallback is
// nginx's, the route is the document's <base>.
{
  const deep = await openApp(BASE + "/app/agents");
  check("a deep link under /app/ is served the app", deep.status === 200, String(deep.status));
  check("the app paints a first frame there too", deep.painted);
  check("and it opens that route, not the default one", deep.url === BASE + "/app/agents", deep.url);
  check(
    "and it really got there — it asked the backend for agents",
    deep.calls.includes("/mt/agent"),
    deep.calls.filter((p) => p.startsWith("/mt/")).join(" ") || "no /mt/ calls at all",
  );
  check("no page errors on a deep link", deep.errors.length === 0, deep.errors.slice(0, 3).join(" | "));
}

// ── …and a deeper one ─────────────────────────────────────────────────────────────────────────
//
// Two segments, not one, and that difference has already cost a rewrite of this fix. A RELATIVE
// <base href="./"> passes every check above — the browser resolves it against the document's URL,
// which at /app/agents is /app/ — and then breaks here, because at /app/chats/206 it resolves to
// /app/chats/ and the app looks for its engine under a conversation. Deep links are not the edge
// case; they are how anybody shares anything, so one of them is checked at the depth people
// actually send.
{
  const deeper = await openApp(BASE + "/app/chats/206");
  check("a two-segment deep link is served the app", deeper.status === 200, String(deeper.status));
  check("the app paints a first frame at depth", deeper.painted);
  check("and stays on that route", deeper.url === BASE + "/app/chats/206", deeper.url);
  check(
    "and loaded its own code, not something resolved against the route",
    deeper.calls.includes("/app/main.dart.js"),
    deeper.calls.filter((p) => p.endsWith("main.dart.js")).join(" ") || "never asked for main.dart.js",
  );
  check("no page errors at depth", deeper.errors.length === 0, deeper.errors.slice(0, 3).join(" | "));
}

// ── The service worker belongs to the app, not to the site ────────────────────────────────────
//
// Its scope is decided by where the script is, so a worker still registered at the root would sit
// in front of the marketing pages and answer them out of the app's cache.
{
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(BASE + "/app/", { waitUntil: "load" });
  const scope = await page
    .waitForFunction(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return registration ? registration.scope : false;
    }, null, { timeout: 30000 })
    .then((handle) => handle.jsonValue())
    .catch(() => null);
  check("the service worker registers under /app/", scope === BASE + "/app/", String(scope));
  await context.close();
}

// ── The deployment-level endpoints did not move ───────────────────────────────────────────────
//
// Every existing client — the connector, the installer, ops' own curl — asks for these by name at
// the origin root. They are the reason the app moved rather than the API.
{
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(BASE + "/", { waitUntil: "load" });
  const version = await page.evaluate(async () => {
    const response = await fetch("/version", { cache: "no-store" });
    return { status: response.status, text: (await response.text()).trim() };
  });
  check("/version is still at the origin root", version.status === 200 && version.text.length > 0, version.text);
  await context.close();
}

// ── The worker races every published line ─────────────────────────────────────────────────────
//
// The engine, the assets and the fonts are fetched by the browser rather than by Dart, so the
// page's own redundant transport never sees them and they all go over one origin — which, measured
// against production, is the slowest of the six lines published there. The worker is the only place
// that can intercept them, and it now sends each one to every line at once and takes the first
// answer.
//
// Two things have to be true and neither is visible from the page: that a second line is really
// used, and that a line which is simply DOWN costs nothing. The evidence for the first is the
// second gateway's own access log — it is a separate container serving the same tree, so anything
// in its log got there because the worker asked it. The dead line is a port with nothing behind it.
if (process.env.CHECK_BUNDLE_LINE2 && process.env.CHECK_BUNDLE_LINE2_CONTAINER) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && !isExpectedNoise(m.text())) errors.push(m.text());
  });

  // First load registers the worker; it cannot race what it is not yet controlling. The reload is
  // the load under test, and it is also the honest one: this is what every visitor gets after a
  // deploy has emptied their cache.
  await page.goto(BASE + "/app/", { waitUntil: "load" });
  const controlling = await page
    .waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 60000 })
    .then(() => true)
    .catch(() => false);
  check("the worker takes control before the race can happen", controlling);

  await page.reload({ waitUntil: "load" });
  const painted = await page
    .waitForFunction(() => document.documentElement.dataset.mtReady === "1", null, { timeout: 90000 })
    .then(() => true)
    .catch(() => false);
  await page.waitForURL("**/app/chats", { timeout: 20000 }).catch(() => {});

  // The dead line is published the whole time. If a line that never answers could hold up the race,
  // this is where it would show.
  check("the app still starts with a dead line published", painted);
  check("and still routes", page.url() === BASE + "/app/chats", page.url());
  check("no page errors while racing", errors.length === 0, errors.slice(0, 3).join(" | "));

  const log = execFileSync("docker", ["logs", process.env.CHECK_BUNDLE_LINE2_CONTAINER], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const served = log.split("\n").filter((line) => line.includes("GET /app/"));
  check(
    "the second line really served the app's files",
    served.length > 0,
    served.length ? `${served.length} requests reached it` : "nothing reached it",
  );
  await context.close();
}

await browser.close();

if (failures.length) {
  console.error(`\n${failures.length} failed:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log("\nthe bundle, behind the real gateway, is what it says it is");
