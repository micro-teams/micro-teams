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

import { createHash } from "node:crypto";
import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const dist = path.resolve(process.argv[2] ?? "build/web");

/** What the version is taken over: the code, not the assets around it. */
const VERSIONED = ["main.dart.js", "flutter_bootstrap.js", "index.html"];

async function hashOf(files) {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(await readFile(path.join(dist, file)));
  }
  return hash.digest("hex").slice(0, 16);
}

async function present(files) {
  const out = [];
  for (const file of files) {
    try {
      await stat(path.join(dist, file));
      out.push(file);
    } catch {
      // A build without main.dart.js is a build that will not run; the check will say so far more
      // clearly than a missing-file crash here would.
    }
  }
  return out;
}

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

const version = await hashOf(await present(VERSIONED));

const source = await readFile(path.join(dist, "sw.js"), "utf8");
if (!source.includes("__MT_BUILD__")) {
  console.error("sw.js has no __MT_BUILD__ placeholder — did web/sw.js change?");
  process.exit(1);
}
await writeFile(path.join(dist, "sw.js"), source.replace("__MT_BUILD__", version));

/**
 * What the server says is deployed, for the worker to check itself against.
 *
 * Small on purpose: a worker asks for this on every navigation, and it is served without caching.
 * The per-file hashes are not used by the worker — the one version is enough to know it is behind —
 * but they make a broken deploy diagnosable from outside, which is how the 2026-08-21 one was
 * found: the worker's version simply did not match the files it was serving.
 */
const files = {};
for (const file of await present(VERSIONED)) {
  files[`/${file}`] = createHash("sha256")
    .update(await readFile(path.join(dist, file)))
    .digest("hex")
    .slice(0, 16);
}
await writeFile(
  path.join(dist, "build.json"),
  `${JSON.stringify({ version, files }, null, 2)}\n`,
);

await rm(path.join(dist, "flutter_service_worker.js"), { force: true });

// Symbol maps are for reading a stack trace, not for running the app: several megabytes each, and
// nothing fetches them. They have no business in a deployment bundle.
for (const entry of await readdir(dist, { recursive: true })) {
  if (entry.endsWith(".symbols")) await rm(path.join(dist, entry), { force: true });
}

console.log(`service worker stamped ${version}`);
