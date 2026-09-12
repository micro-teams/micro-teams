/*
 *  Description: Stamps the built service worker with a version, and removes Flutter's.
 *
 *               A service worker is only replaced when its BYTES change, so a worker with a
 *               constant body would serve the first build it ever cached for as long as the browser
 *               lives. The version here is a hash of what the build actually produced, which means
 *               a new build is a new cache and the old one is deleted on activation — and an
 *               unchanged build is not a pointless re-download.
 *
 *               It also deletes flutter_service_worker.js. Flutter still emits it, but its loader
 *               no longer registers it on a first visit and warns that doing so is deprecated (see
 *               web/sw.js). Leaving a second, dead worker in the bundle is how someone later spends
 *               an afternoon debugging the wrong file.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 */

import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { appVersion } from "./version.mjs";

const dist = path.resolve(process.argv[2] ?? "build/web");

/**
 * Flutter's own worker is deleted below, so the call that loads it has to go too.
 *
 * It is not dead code once the launcher is in front of the app: the launcher registers OUR worker
 * before the engine starts, and Flutter's loader only asks for `flutter_service_worker.js` when a
 * registration already exists. So the file it asks for is missing, the SPA fallback answers with
 * index.html, and the browser reports a script with an unsupported MIME type — a console error on
 * every first visit, for a worker we deliberately do not ship. Rewritten before the hash, because
 * the hash is over what is actually served.
 */
const bootstrap = path.join(dist, "flutter_bootstrap.js");
const bootstrapSource = await readFile(bootstrap, "utf8");
// The call at the very end of the file, not the word anywhere in it: the minified loader mentions
// both `serviceWorkerSettings` and `serviceWorkerVersion` in its own code, so a search would find
// the wrong thing and running this step twice would look like a failure.
const CALL = /_flutter\.loader\.load\(\{[\s\S]*?\}\);\s*$/;
if (!CALL.test(bootstrapSource)) {
  console.error("flutter_bootstrap.js does not end in _flutter.loader.load({…}) — did it change?");
  process.exit(1);
}
await writeFile(bootstrap, bootstrapSource.replace(CALL, "_flutter.loader.load({});\n"));

// One version for the whole bundle, the same string CI stamped everything else with. It replaces
// the hash this file used to compute over three files: a hash of its own devising could only ever
// answer "did these three change?", while the question that matters is "is this the build that is
// deployed?" — which only something outside the bundle can answer.
const version = await appVersion();

// Read from web/sw.js rather than from the copy in the bundle, so running this step twice is not a
// mistake anyone can make: the second run would otherwise find an already-stamped file, no
// placeholder in it, and stop the build.
const source = await readFile(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "web", "sw.js"),
  "utf8",
);
if (!source.includes("__MT_BUILD__")) {
  console.error("web/sw.js has no __MT_BUILD__ placeholder — did it change?");
  process.exit(1);
}
await writeFile(path.join(dist, "sw.js"), source.replace("__MT_BUILD__", version));

/**
 * What the server says is deployed, as one line of text at the bundle root.
 *
 * The launcher carries the same string inside itself and asks for this on every start; when they
 * disagree, everything cached under the origin is from the older build and goes. That check used to
 * live in the worker, comparing a hash it had computed over three files on a 60-second timer — an
 * arrangement in which the thing doing the checking was itself one of the things that could be
 * stale. The question belongs to the one part of a page load that cannot be answered from a cache.
 */
await writeFile(path.join(dist, "version"), `${version}\n`);
// The old answer to the same question. Left behind, a deployed bundle would carry two versions and
// nothing would say which one was current.
await rm(path.join(dist, "build.json"), { force: true });

await rm(path.join(dist, "flutter_service_worker.js"), { force: true });

// Symbol maps are for reading a stack trace, not for running the app: several megabytes each, and
// nothing fetches them. They have no business in a deployment bundle.
for (const entry of await readdir(dist, { recursive: true })) {
  if (entry.endsWith(".symbols")) await rm(path.join(dist, entry), { force: true });
}

console.log(`service worker stamped ${version}`);
