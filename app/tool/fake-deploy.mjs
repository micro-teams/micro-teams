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

import { createHash } from "node:crypto";
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

const VERSIONED = ["main.dart.js", "flutter_bootstrap.js", "index.html"];
const hash = createHash("sha256");
const files = {};
for (const file of VERSIONED) {
  const bytes = await readFile(path.join(dist, file));
  hash.update(bytes);
  files[`/${file}`] = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}
const version = hash.digest("hex").slice(0, 16);

const sw = await readFile(path.join(dist, "sw.js"), "utf8");
const current = /const VERSION = "([^"]+)"/.exec(sw)?.[1];
if (!current) {
  console.error("no stamped VERSION in sw.js — run tool/make-sw.mjs first");
  process.exit(1);
}
await writeFile(path.join(dist, "sw.js"), sw.replace(current, version));
await writeFile(path.join(dist, "build.json"), `${JSON.stringify({ version, files }, null, 2)}\n`);

console.log(`deployed ${current} -> ${version} (${marker})`);
