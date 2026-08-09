/*
 *  Description: The launcher and the Service Worker, checked by a real browser.
 *
 *               Everything here is a browser behaviour, and none of it can be asserted any other
 *               way: whether a worker registers, what it stores, whether the application starts
 *               with the network switched off, and whether the escape hatch really clears it. This
 *               file exists because the first version of the build step passed every unit test and
 *               did not start offline — the document itself was missing from the manifest, and only
 *               a browser could say so.
 *
 *  Author(s):
 *      agent3
 */

import { chromium } from "@playwright/test";

const BASE = process.env.LAUNCHER_CHECK_BASE ?? "http://127.0.0.1:8931";
const failures = [];
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures.push(name);
}

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

await page.goto(BASE + "/", { waitUntil: "networkidle" });

const rootHtml = await page.$eval("#root", (el) => el.innerHTML.length).catch(() => 0);
check("the launcher boots the app (something rendered into #root)", rootHtml > 0, `${rootHtml} bytes`);

const styled = await page.evaluate(() => {
  const el = document.querySelector("#root *");
  return el ? getComputedStyle(el).fontFamily : "";
});
check("the stylesheet is applied", styled !== "" && styled !== "serif", styled);

const registered = await page.evaluate(async () => {
  const rs = await navigator.serviceWorker.getRegistrations();
  return rs.length;
});
check("a service worker registered", registered > 0, `${registered} registration(s)`);

await page.waitForFunction(async () => (await caches.keys()).length > 0, null, { timeout: 15000 }).catch(() => {});
const cacheNames = await page.evaluate(() => caches.keys());
check("the precache was populated", cacheNames.length > 0, cacheNames.join(","));

const cached = await page.evaluate(async () => {
  const names = await caches.keys();
  if (!names.length) return [];
  const cache = await caches.open(names[0]);
  return (await cache.keys()).map((r) => new URL(r.url).pathname);
});
check("the entry module is on disk", cached.some((p) => p.startsWith("/assets/") && p.endsWith(".js")), cached.join(" "));
check("no API response was cached", !cached.some((p) => p.startsWith("/mt/")), cached.filter((p) => p.startsWith("/mt/")).join(" "));
check("the web app manifest is on disk", cached.includes("/manifest.webmanifest"), cached.join(" "));

// Installability, as the browser sees it — not as the source claims it. The launcher REPLACES the
// built document, so a manifest link present in index.html says nothing about the document an
// installed app would actually open; only reading it back from the served page does.
const manifest = await page.evaluate(async () => {
  const link = document.querySelector('link[rel="manifest"]');
  if (!link) return { linked: false };
  const res = await fetch(link.href);
  const body = await res.json().catch(() => null);
  return { linked: true, status: res.status, body };
});
check("the launcher links a manifest from <head>", manifest.linked === true);
check("the manifest is served and parses", manifest.body != null, `status ${manifest.status}`);
check(
  "the manifest asks for a standalone window",
  manifest.body?.display === "standalone",
  String(manifest.body?.display),
);
check(
  "the manifest offers a 512px and a maskable icon",
  manifest.body?.icons?.some((i) => i.sizes === "512x512" && i.purpose === "any") &&
    manifest.body?.icons?.some((i) => i.purpose === "maskable"),
  JSON.stringify(manifest.body?.icons?.map((i) => `${i.sizes} ${i.purpose}`) ?? []),
);
const iconsOk = await page.evaluate(async (icons) => {
  const results = await Promise.all(
    icons.map(async (src) => [src, (await fetch(src)).status]),
  );
  return results.filter(([, status]) => status !== 200);
}, (await page.evaluate(async () => {
  const link = document.querySelector('link[rel="manifest"]');
  const body = await (await fetch(link.href)).json();
  return body.icons.map((i) => i.src);
})));
check("every declared icon is actually served", iconsOk.length === 0, JSON.stringify(iconsOk));

// The claim the whole precache exists for: it starts with no network at all.
await context.setOffline(true);
const offline = await context.newPage();
const offErrors = [];
offline.on("pageerror", (e) => offErrors.push(String(e)));
const offlineResponse = await offline
  .goto(BASE + "/", { waitUntil: "load" })
  .catch((e) => { offErrors.push(String(e)); return null; });
check("the document itself came from the cache", offlineResponse?.status() === 200, String(offlineResponse?.status()));
// Waited for, not sampled: the shell renders after the module has been imported and React has run,
// and reading #root the instant "load" fires measures the test's patience rather than the cache.
await offline
  .waitForFunction(() => (document.querySelector("#root")?.innerHTML.length ?? 0) > 0, null, { timeout: 15000 })
  .catch(() => {});
const offlineRoot = await offline.$eval("#root", (el) => el.innerHTML.length).catch(() => 0);
check("the app shell starts offline, from the cache", offlineRoot > 0, `${offlineRoot} bytes rendered`);
await offline.close();
await context.setOffline(false);

// And the way out.
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

// --- and what happens the day a second line exists ------------------------------------------
//
// Everything above runs the single-line deployment we have. This runs the one we are about to
// have, because the launcher behaves *differently* with two: it races the entry module across both
// origins and imports it from the winner. That import is cross-origin, which the browser refuses
// without a header on the static assets — a failure that cannot appear until the second line does,
// and would then present as "the app does not start", intermittently, depending on who won.
if (process.env.LAUNCHER_CHECK_SECOND_BASE) {
  const raced = await browser.newContext();
  const page2 = await raced.newPage();
  const asked = new Set();
  page2.on("request", (r) => {
    const url = new URL(r.url());
    if (url.pathname.startsWith("/assets/")) asked.add(url.origin);
  });
  const errors2 = [];
  page2.on("pageerror", (e) => errors2.push(String(e)));

  await page2.goto(BASE + "/", { waitUntil: "networkidle" });
  await page2
    .waitForFunction(() => (document.querySelector("#root")?.innerHTML.length ?? 0) > 0, null, {
      timeout: 15000,
    })
    .catch(() => {});

  const rendered = await page2.$eval("#root", (el) => el.innerHTML.length).catch(() => 0);
  check("with two lines, the app still starts", rendered > 0, `${rendered} bytes`);
  check("both lines were raced for the entry module", asked.size === 2, [...asked].join(" "));
  check("no page errors with two lines", errors2.length === 0, errors2.slice(0, 2).join(" | "));

  await raced.close();
}

await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED` : "\nall checks passed");
process.exit(failures.length ? 1 : 0);
