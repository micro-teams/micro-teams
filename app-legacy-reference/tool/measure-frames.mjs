/*
 *  Description: What scrolling a real conversation costs, in frames.
 *
 *               The message list is the one screen people spend their day in, and the only honest
 *               way to talk about its cost is a number: how many frames took longer than the 16.7ms
 *               a 60Hz display gives you. Everything else — "this looks heavy", "that should be
 *               faster" — is an opinion that survives whichever change is made next.
 *
 *               Measured with requestAnimationFrame deltas rather than Flutter's own timings,
 *               because that is what the display actually did.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 */

import { chromium } from "playwright";

const BASE = process.env.CHECK_WEB_BASE ?? "http://127.0.0.1:8931";
const ROUNDS = Number(process.env.ROUNDS ?? 6);

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 900, height: 800 } })).newPage();

await page.goto(`${BASE}/chats/5`, { waitUntil: "load" });
await page.waitForFunction(() => document.documentElement.dataset.mtReady === "1", null, {
  timeout: 60000,
});
await page.waitForTimeout(3000);

await page.evaluate(() => {
  window.__frames = [];
  let last = performance.now();
  const tick = (now) => {
    window.__frames.push(now - last);
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

// Scroll the way a person reads back through a conversation: a flick, a pause, a flick.
for (let i = 0; i < ROUNDS; i++) {
  await page.mouse.move(450, 400);
  await page.mouse.wheel(0, i % 2 === 0 ? -1200 : 1200);
  await page.waitForTimeout(220);
}

const frames = await page.evaluate(() => window.__frames.slice(1));
const sorted = [...frames].sort((a, b) => a - b);
const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
const dropped = frames.filter((f) => f > 16.7).length;

console.log(
  JSON.stringify(
    {
      frames: frames.length,
      droppedOver16ms: dropped,
      medianMs: Number(at(0.5).toFixed(1)),
      p95Ms: Number(at(0.95).toFixed(1)),
      worstMs: Number(at(1).toFixed(1)),
    },
    null,
    1,
  ),
);

await browser.close();
