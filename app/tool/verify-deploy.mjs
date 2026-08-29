/*
 *  Description: Ask a deployment whether it deployed.
 *
 *               A Service Worker is only replaced when its own bytes change. So a deploy that
 *               copies new application files beside an OLD sw.js is invisible: no update, no
 *               activate, no eviction, and every visitor keeps running the build the worker
 *               cached. Nothing about that looks wrong from the outside — the files are new, the
 *               site is up, and the app is old.
 *
 *               That is not hypothetical. On 2026-08-21 production served a main.dart.js from
 *               16:41 next to an sw.js from 15:21, and "we deployed and nothing changed" was the
 *               only symptom. This script is what would have said so in one line.
 *
 *               It checks two things against a live origin: that everything which carries a version
 *               carries the SAME one — the worker, the launcher, and /version — and that the entry
 *               points are not held by an HTTP cache (a four-hour max-age on an unfingerprinted
 *               main.dart.js hides a deploy for four hours).
 *
 *               The version used to be a hash this script computed over three files, and there was
 *               a /build.json beside it. Both are gone: one build stamp, x.y.z-commit, is written
 *               into the worker, the launcher and /version by tool/make-sw.mjs. This script kept
 *               asking the old questions and so failed against a perfectly good deployment, which
 *               is worse than not checking — a check that always fails is one nobody reads.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 */

const origin = (process.argv[2] ?? "https://microteams.app").replace(/\/$/, "");

const failures = [];
function check(what, ok, detail = "") {
  console.log(
    `${ok ? "ok  " : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`,
  );
  if (!ok) failures.push(what);
}

async function get(path) {
  const response = await fetch(`${origin}${path}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path} -> ${response.status}`);
  return response;
}

const sw = await get("/sw.js").then((r) => r.text());
const baked = sw.match(/const VERSION = "([^"]+)"/)?.[1];
check("the worker carries a version", Boolean(baked), baked ?? "none");

// What this deployment says it is. Never cached, and the one answer that cannot come from a cache.
const served = (await get("/version").then((r) => r.text())).trim();
check(
  "the deployment says which build it is",
  Boolean(served),
  served || "none",
);

// The worker is the thing that can be stale while everything around it is new: it is replaced only
// when its own bytes change, so a deploy that copies new files beside an old sw.js is invisible.
check(
  "the worker is the one that cached these files",
  baked === served,
  `worker ${baked}, deployment ${served}`,
);

// The launcher carries the same string and asks /version for it on every start. If the document is
// stale the app decides staleness against the wrong number.
const index = await get("/").then((r) => r.text());
check(
  "the launcher agrees",
  index.includes(served),
  index.includes(served) ? served : "the served document names another build",
);

for (const path of ["/", "/sw.js", "/main.dart.js"]) {
  const cacheControl =
    (await fetch(`${origin}${path}`, { cache: "no-store" })).headers.get(
      "cache-control",
    ) ?? "";
  const held = /max-age=(\d+)/.exec(cacheControl);
  check(
    `${path} is revalidated rather than held`,
    !held || Number(held[1]) === 0,
    cacheControl || "no cache-control",
  );
}

console.log(
  failures.length
    ? `\n${failures.length} FAILED`
    : "\nthis deployment is consistent",
);
process.exit(failures.length ? 1 : 0);
