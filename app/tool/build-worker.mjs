/*
 * Builds the service worker into an exported web bundle.
 *
 *   node tool/build-worker.mjs <web-dist>
 *
 * Bundles worker/sw.ts (with the multipath client) into <web-dist>/sw.js, telling it what to
 * precache — the document, the entry scripts and stylesheets under _expo/static/, the favicon, the
 * manifest and its small icon — and a build id: a hash of those files, so a build that changed any
 * of them is a new cache and one that changed none of them is not.
 */
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [dist] = process.argv.slice(2);
if (!dist) {
  console.error("usage: build-worker.mjs <web-dist>");
  process.exit(2);
}

const scripts = path.join(dist, "_expo", "static", "js", "web");
const entries = (await readdir(scripts).catch(() => [])).filter((f) => f.endsWith(".js")).map((f) => `_expo/static/js/web/${f}`);
const styles = (await readdir(path.join(dist, "_expo", "static", "css")).catch(() => []))
  .filter((f) => f.endsWith(".css"))
  .map((f) => `_expo/static/css/${f}`);
const shell = ["index.html", ...entries, ...styles];
for (const optional of ["favicon.svg", "manifest.json", "icon-192.png"]) {
  if (await readFile(path.join(dist, optional)).then(() => true, () => false)) shell.push(optional);
}
if (!entries.length) {
  console.error(`no entry script under ${scripts}: is ${dist} an exported web bundle?`);
  process.exit(1);
}

const hash = createHash("sha256");
for (const f of shell) hash.update(f).update(await readFile(path.join(dist, f)));
const id = hash.digest("hex").slice(0, 12);

const here = path.dirname(fileURLToPath(import.meta.url));
await build({
  entryPoints: [path.join(here, "..", "worker", "sw.ts")],
  outfile: path.join(dist, "sw.js"),
  bundle: true,
  format: "iife",
  target: "es2022",
  minify: true,
  legalComments: "none",
  define: { __MT_BUILD__: JSON.stringify(id), __MT_SHELL__: JSON.stringify(shell) },
});
console.log(`sw.js: build ${id}, precaching ${shell.join(", ")}`);
