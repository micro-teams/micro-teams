/*
 *  Description: Puts a NEW build on top of a directory somebody is already serving.
 *
 *               Not a toy: "a deploy landed while a browser had the previous build cached" is the
 *               state that produced the worst bug this client has had — a page that reached 100%
 *               and then never painted, because the new main.dart.js was handed the previous
 *               build's engine out of the cache. It cannot be checked without being able to deploy
 *               mid-session, so this is the smallest thing that is honestly a deploy: the code's
 *               bytes change, the engine's bytes change, and the stamp changes with them.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 */

import { appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const dist = path.resolve(process.argv[2] ?? "build/web");
const marker = process.argv[3] ?? `redeploy-${Date.now()}`;

// The engine too, and under its own name: canvaskit.js keeps that name from build to build, which
// is exactly why a stale copy of it can be served to a new application.
const ENGINE = "canvaskit/chromium/canvaskit.js";
for (const file of ["main.dart.js", ENGINE]) {
  await appendFile(path.join(dist, file), `\n// ${marker}\n`);
}

// A deploy is a new version, said in all the places a build says it: the launcher carries it, the
// worker is stamped with it, and /version serves it.
const sw = await readFile(path.join(dist, "sw.js"), "utf8");
const current = /const VERSION = "([^"]+)"/.exec(sw)?.[1];
if (!current) {
  console.error("no stamped VERSION in sw.js — run tool/make-sw.mjs first");
  process.exit(1);
}
const version = `${current.split("-")[0]}-${marker.slice(-7)}`;

await writeFile(path.join(dist, "sw.js"), sw.replace(current, version));
await writeFile(path.join(dist, "version"), `${version}\n`);
const launcher = await readFile(path.join(dist, "index.html"), "utf8");
await writeFile(path.join(dist, "index.html"), launcher.split(current).join(version));

console.log(`deployed ${current} -> ${version} (${marker})`);
