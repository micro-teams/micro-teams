/*
 *  Description: Turns the finished Flutter build into a launcher-started one.
 *
 *               There is exactly one request in the whole system that cannot be spread across
 *               lines: the first document. A browser opening a URL knows one host, and no amount of
 *               client-side cleverness changes that. So that document is made as small as possible
 *               and given one job — register the worker, carry the line registry inline, and start
 *               the real entry point on whichever line answers first. Everything after it comes
 *               from the cache or from the fastest line, and the domain the user typed stops
 *               mattering.
 *
 *               Flutter's own index.html is kept, under app.html: it is what /unregister.html sends
 *               people back to, and the quickest way to answer "is the launcher the problem?".
 *
 *               What this file decides, because the library cannot: that flutter_bootstrap.js is
 *               the entry point and main.dart.js is the weight behind it. The bootstrap is 13KB and
 *               wins the race in milliseconds; main.dart.js is 3.4MB and is what the visitor is
 *               actually waiting for. Naming it as a preload fetches it on the line that just
 *               proved itself fastest — warm in the HTTP cache by the time the engine asks — and
 *               makes its bytes the ones the percentage is a percentage of.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 */

import { readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildLauncher } from "@micro-teams/multipath";

const dist = path.resolve(process.argv[2] ?? "build/web");

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * The splash, and why it is hand-written HTML rather than anything cleverer.
 *
 * It is on the one request with no redundancy and no cache, so it is a background colour, a word
 * and a number — nothing that needs a font file, an image or a second request. The colour is the
 * app's own #060606, so the handover to the first Flutter frame is invisible.
 *
 * It hides itself on `data-mt-ready`, which the app sets after its first frame (see
 * lib/src/common/ready_signal_web.dart). Hiding it when the module finishes importing would be too
 * early by seconds: the engine has still to boot, and the visitor would watch a black screen with
 * nothing on it — which is exactly what the percentage exists to prevent.
 */
const SPLASH = `<div id="mt-splash">
  <div id="mt-splash-name">MicroTeams</div>
  <div id="mt-splash-percent" data-multipath-progress>0%</div>
  <div id="mt-splash-slow" hidden>
    <div>This is taking longer than it should.</div>
    <div id="mt-splash-ways">
      <a href="" onclick="location.reload();return false">try again</a>
      &nbsp;·&nbsp;
      <a href="/unregister.html">clear this app&#39;s cache</a>
    </div>
  </div>
</div>
<script>
// A percentage that reaches 100 and stays there is the worst thing this screen can do: it is
// indistinguishable from a broken app, and it offers nothing to press. If the app has not painted
// its first frame by now, say so and offer the two things that actually help.
//
// Deliberately not a reload of its own: a page that reloads itself when something is wrong is a
// page that can spend all afternoon reloading, and the second attempt is not more likely to work
// than the first unless a human changes something.
(function () {
  var after = window.__mtSlowAfter || 20000;
  setTimeout(function () {
    if (document.documentElement.dataset.mtReady === "1") return;
    var slow = document.getElementById("mt-splash-slow");
    if (slow) slow.hidden = false;
    console.error(
      "mt: no first frame after " + after + "ms — the app did not start. Loaded: " +
        (document.querySelector("[data-multipath-progress]") || {}).textContent
    );
  }, after);
})();
</script>`;

const SPLASH_CSS = `<style>
html, body { margin: 0; padding: 0; height: 100%; background: #060606; }
#mt-splash {
  position: fixed; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 12px;
  background: #060606; color: #f5f5f5; z-index: 2147483647;
  font: 500 15px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  transition: opacity .2s ease;
}
#mt-splash-percent { color: #8a8a8a; font-variant-numeric: tabular-nums; }
#mt-splash-slow { color: #8a8a8a; font-size: 13px; text-align: center; line-height: 1.8; }
#mt-splash-slow a { color: #f5f5f5; }
html[data-mt-ready="1"] #mt-splash { opacity: 0; pointer-events: none; }
[data-multipath-error] { position: fixed; inset: auto 0 24px; text-align: center;
  color: #f5f5f5; font: 400 14px system-ui, sans-serif; z-index: 2147483647; }
</style>`;

/** Everything Flutter's document carries that the launcher has to carry too. */
const HEAD = `<base href="/">
<meta name="description" content="Chat with your team and the agents running on your machines.">
<meta name="theme-color" content="#060606">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black">
<meta name="apple-mobile-web-app-title" content="MicroTeams">
<link rel="apple-touch-icon" href="/icon-192.png">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="manifest" href="/manifest.json">
${SPLASH_CSS}`;

export async function build(dir) {
  // Idempotent: after the first run index.html is the launcher, so a second run must read app.html
  // rather than turn the launcher into the input for another launcher. Running a build step twice
  // must not be a mistake anyone can make.
  const source = (await exists(path.join(dir, "app.html")))
    ? path.join(dir, "app.html")
    : path.join(dir, "index.html");
  const original = await readFile(source, "utf8");
  if (!original.includes("flutter_bootstrap.js")) {
    throw new Error(`${source} does not load flutter_bootstrap.js — did the build change?`);
  }
  if (source.endsWith("index.html")) await rename(source, path.join(dir, "app.html"));

  await writeFile(
    path.join(dir, "index.html"),
    buildLauncher({
      appEntry: "/flutter_bootstrap.js",
      // The 3.4MB the visitor is actually waiting for, fetched on the winning line and counted.
      preload: ["/main.dart.js"],
      serviceWorker: "/sw.js",
      // Hand-written and free of imports, so "classic" — see web/sw.js. Registering a module worker
      // as classic fails quietly: the page works from the network and only the cache is never
      // filled.
      serviceWorkerType: "classic",
      // One same-origin line, inline. The app refreshes this from /mt/lines once it is running;
      // what is baked in only has to be enough to start, and "wherever this page came from" always
      // is.
      registry: { lines: [{ id: "origin", url: "", transport: "same-origin", weight: 100 }] },
      registryUrl: "/mt/lines",
      title: "MicroTeams",
      headHtml: HEAD,
      bodyHtml: SPLASH,
    }),
    "utf8",
  );
  return { bytes: (await stat(path.join(dir, "index.html"))).size };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { bytes } = await build(dist);
  console.log(`launcher: index.html is ${bytes} bytes, Flutter's document kept as app.html`);
}
