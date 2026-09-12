/*
 *  Description: Does the web frontend's own service worker actually carry traffic over
 *               MultiPath, against a real deployment?
 *
 *               tool/check-web.mjs proves the worker itself — that it registers, caches, survives
 *               offline — against a bare static server with no origin process behind it, so the
 *               one thing it structurally cannot prove is whether the worker's substrate ever
 *               carries a real line. The e2e journey (run.sh) has a real origin and a real backend,
 *               but deliberately serves no service worker to the driven build, for the opposite
 *               reason: a worker there would precache the DEPLOYED bundle's frontend over the
 *               flutter-drive build actually under test.
 *
 *               So neither existing check can see "the worker really dialled a line and carried a
 *               request over it" happen against a real deployment. This is the one that can: it
 *               opens the bundle's OWN frontend — the real production build, the real launcher,
 *               the real worker — served by the real nginx with the real origin process behind it
 *               (see deploy/docker-compose.yml), and reads back what the worker itself reports at
 *               /__mt/transport (see web/sw.js) after the app has made its first real requests.
 *
 *               No driven interaction is needed: opening the app is already enough traffic to dial
 *               and use a line, and asking any more of it would just be re-proving tool/check-web.mjs
 *               against a heavier stack.
 *
 *  Usage: node check-substrate.mjs <base-url>
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 */

import { chromium } from "playwright";

const BASE = process.argv[2];
if (!BASE) {
  console.error("usage: node check-substrate.mjs <base-url>");
  process.exit(2);
}

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();

try {
  await page.goto(BASE + "/", { waitUntil: "load" });
  // The launcher's own signal that the app has painted (see ready_signal_web.dart). Reached rather
  // than asserted first, because a worker that failed to register would still leave the app
  // starting from the network — this check is specifically about the worker's transport, not about
  // whether the app runs at all.
  await page.waitForFunction(
    () => document.documentElement.dataset.mtReady === "1",
    null,
    { timeout: 30000 },
  );

  // Registration can lag the first frame by a beat, and the app makes at most one /mt/ or /api/
  // request on its own (the session restore) before it settles on a signed-out screen and goes
  // quiet — one triggering request is not the same guarantee as "the worker got a fair chance",
  // because that one request may race the worker's own registration and lose. So each iteration
  // also fires an explicit /mt/probe: cheap, side-effect-free, and — because it goes through this
  // app's own fetch(), not this script's — it is answered by the worker exactly as a real request
  // from the app would be, which is the thing being proven.
  let lines = null;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    lines = await page.evaluate(async () => {
      try {
        await fetch("/mt/probe", { cache: "no-store" }).catch(() => {});
        const res = await fetch("/__mt/transport", { cache: "no-store" });
        if (!res.ok) return null;
        const body = await res.json();
        return Array.isArray(body.lines) && body.lines.length > 0 ? body.lines : null;
      } catch {
        return null;
      }
    });
    if (lines) break;
    await page.waitForTimeout(1000);
  }
  lines ??= [];

  const up = lines.filter((l) => l.state === "up");
  const ok = up.length > 0;
  console.log(
    `${ok ? "ok  " : "FAIL"}  a real deployment's service worker is carrying at least one line` +
      `  (${JSON.stringify(lines)})`,
  );
  await browser.close();
  process.exit(ok ? 0 : 1);
} catch (error) {
  console.log(`FAIL  a real deployment's service worker is carrying at least one line  (${error})`);
  await browser.close();
  process.exit(1);
}
