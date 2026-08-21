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
 *               It checks two things against a live origin: that the worker's baked-in version
 *               matches the files actually being served, and that the entry points are not held by
 *               an HTTP cache (a four-hour max-age on an unfingerprinted main.dart.js hides a
 *               deploy for four hours).
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 */

import { createHash } from "node:crypto";

const origin = (process.argv[2] ?? "https://microteams.app").replace(/\/$/, "");

/** The same list, in the same order, as tool/make-sw.mjs hashes. */
const VERSIONED = ["main.dart.js", "flutter_bootstrap.js", "index.html"];

const failures = [];
function check(what, ok, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
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

const digest = createHash("sha256");
for (const file of VERSIONED) {
  digest.update(Buffer.from(await get(`/${file}`).then((r) => r.arrayBuffer())));
}
const served = digest.digest("hex").slice(0, 16);
check(
  "the worker is the one that cached these files",
  baked === served,
  `worker ${baked}, files ${served}`,
);

// The build stamp the worker checks itself against. Absent on a deployment older than this script.
try {
  const build = await get("/build.json").then((r) => r.json());
  check("the build stamp agrees too", build.version === served, build.version);
} catch {
  check("a build stamp is served", false, "no /build.json");
}

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

console.log(failures.length ? `\n${failures.length} FAILED` : "\nthis deployment is consistent");
process.exit(failures.length ? 1 : 0);
