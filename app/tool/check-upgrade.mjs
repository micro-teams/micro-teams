/*
 *  Description: The one deploy where the service worker's SCOPE changes.
 *
 *               Every existing visitor has a worker registered at "/", from a build that served the
 *               app there. This deploy serves the app from /app/ and the marketing site from "/", so
 *               the new worker registers at /app/ — and the old one does not go away by itself. A
 *               worker is not replaced by a worker at a different scope; it keeps its registration,
 *               keeps its caches, and keeps answering for "/" and everything under it.
 *
 *               The launcher's version guard is what clears it: it asks for getRegistrations(),
 *               which returns EVERY registration on the origin rather than the one matching its own
 *               scope, unregisters all of them, drops the caches and reloads once. That reasoning is
 *               sound and it is also exactly the kind of reasoning this repository has twice shipped
 *               and had to roll back, so it is checked here rather than believed.
 *
 *               It runs in two phases against a PERSISTENT browser profile, because that is the
 *               only honest way to have a returning visitor: phase "before" is served the old
 *               layout by the old gateway and leaves a real root-scoped worker in the profile;
 *               tool/check-bundle.sh then swaps both the config and the tree underneath; phase
 *               "after" opens the same profile on the new deployment.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 */

import { chromium } from "playwright";

const BASE = process.env.CHECK_BUNDLE_BASE ?? "http://127.0.0.1:58090";
const PROFILE = process.env.CHECK_UPGRADE_PROFILE;
const phase = process.argv[2];

if (!PROFILE) {
  console.error("CHECK_UPGRADE_PROFILE must name a directory that survives between phases");
  process.exit(2);
}

const failures = [];
function check(what, ok, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures.push(what);
}

/** Every registration on the origin, with its scope — the question this whole file is about. */
const registrations = (page) =>
  page.evaluate(async () => {
    const all = await navigator.serviceWorker.getRegistrations();
    return all.map((r) => r.scope);
  });

const context = await chromium.launchPersistentContext(PROFILE, { headless: true });
const page = context.pages()[0] ?? (await context.newPage());

if (phase === "before") {
  // The old deployment: the app at the root, its worker at /sw.js, scope "/".
  await page.goto(BASE + "/", { waitUntil: "load" });
  await page
    .waitForFunction(() => document.documentElement.dataset.mtReady === "1", null, { timeout: 90000 })
    .catch(() => {});
  // Waited for, not assumed: a registration that is still installing when the browser closes is not
  // the state a returning visitor comes back to, and the whole point is to come back to a real one.
  const scope = await page
    .waitForFunction(async () => {
      const r = await navigator.serviceWorker.getRegistration();
      return r && r.active ? r.scope : false;
    }, null, { timeout: 60000 })
    .then((handle) => handle.jsonValue())
    .catch(() => null);
  check("the old build leaves an active worker at the root", scope === BASE + "/", String(scope));

  // And that it really filled a cache, so "the caches were dropped" below means something.
  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    let total = 0;
    for (const name of names) total += (await (await caches.open(name)).keys()).length;
    return { names, total };
  });
  check(
    "and a cache with the old build's files in it",
    cached.names.length > 0 && cached.total > 0,
    `${cached.names.join(",")}: ${cached.total} entries`,
  );
} else if (phase === "after") {
  // The same visitor, after the deploy. Nothing here clears anything by hand: whatever happens is
  // what happens to somebody who simply opens the app again.
  const before = await page.goto(BASE + "/app/", { waitUntil: "load" });
  check("the new deployment answers /app/ for a returning visitor", before?.status() === 200);

  // The guard reloads the page once, so the app that eventually paints is the second load. Waiting
  // for the destination rather than for a fixed time is what keeps this from being a race.
  await page.waitForURL("**/app/chats", { timeout: 90000 }).catch(() => {});
  const painted = await page
    .waitForFunction(() => document.documentElement.dataset.mtReady === "1", null, { timeout: 90000 })
    .then(() => true)
    .catch(() => false);
  check("the app starts for them", painted);
  check("and routes, on a profile that had the old build in it", page.url() === BASE + "/app/chats", page.url());

  // Give the settled state time to arrive, then read it ONCE and report whatever is actually there.
  // Asserting on the wait's own result would print "false" on failure, which tells whoever is
  // reading the log nothing about which worker survived — and that is the only thing they need.
  await page
    .waitForFunction(async () => {
      const all = await navigator.serviceWorker.getRegistrations();
      return all.length === 1 && all[0].active;
    }, null, { timeout: 60000 })
    .catch(() => {});
  const scopes = await registrations(page);
  const shown = scopes.length ? scopes.join(" ") : "no registrations at all";

  check("the worker that used to own the root is gone", !scopes.includes(BASE + "/"), shown);
  check(
    "and the only one left is the app's, under /app/",
    scopes.length === 1 && scopes[0] === BASE + "/app/",
    shown,
  );

  // The marketing site must be served by the network, not out of the app's old cache — which is
  // what a surviving root-scoped worker would have done with it.
  const site = await page.goto(BASE + "/", { waitUntil: "load" });
  const heading = await page.textContent("h1").catch(() => null);
  check(
    "and the root now really is the marketing site",
    site?.status() === 200 && Boolean(heading && heading.includes("MicroTeams")),
    heading ?? "no <h1>",
  );
} else {
  console.error(`unknown phase ${phase} — expected "before" or "after"`);
  process.exit(2);
}

await context.close();

if (failures.length) {
  console.error(`\n${failures.length} failed:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
