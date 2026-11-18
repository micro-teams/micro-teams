/*
 * Builds the service worker and the loader into an exported web bundle.
 *
 *   node tool/build-worker.mjs <web-dist>
 *
 * The build's version is MT_VERSION (CI sets VERSION-<commit>, the same string the app shows) or,
 * built by hand without it, a hash of the files below. It names the one cache the loader and the
 * worker share, so a new build is a new cache and every other one is deleted.
 *
 * Writes into <web-dist>:
 *   files.json — { version, files: [{ path, bytes }] }: everything the first screen needs (the
 *     entry scripts and stylesheets, the icon and monospace fonts, Noto Sans SC, the favicon and
 *     manifest), for the loader to cache and to measure its progress against;
 *   index.html — the entry <script> replaced by the loader (worker/loader.js);
 *   sw.js — worker/sw.ts with the multipath client, the version and what to precache.
 */
import { build, transform } from "esbuild";
import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
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
const id = process.env.MT_VERSION?.trim() || hash.digest("hex").slice(0, 12);

// What the first screen needs, beyond the document: the shell, the faces the loader registers, and
// the two fonts the app itself asks for (the icons, and the monospace face through expo-font). The
// other icon sets Expo exports are never loaded and are left out.
async function walk(dir) {
  const out = [];
  for (const e of await readdir(path.join(dist, dir), { withFileTypes: true }).catch(() => [])) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...(await walk(rel)));
    else out.push(rel);
  }
  return out;
}
const fonts = (await walk("assets")).filter((f) => /\/(MaterialIcons|LiberationMono-Regular)\.[0-9a-f]+\.ttf$/.test(f));
const needed = [...shell.filter((f) => f !== "index.html"), ...fonts, "fonts/LiberationMono-Regular.ttf", "fonts/LiberationMono-Bold.ttf", "fonts/NotoSansSC-Regular.otf"];
const files = [];
for (const f of needed) files.push({ path: f, bytes: (await stat(path.join(dist, f))).size });
await writeFile(path.join(dist, "files.json"), `${JSON.stringify({ version: id, files }, null, 2)}\n`);

// The document runs the loader instead of the entry script.
const indexPath = path.join(dist, "index.html");
let index = await readFile(indexPath, "utf8");
const tag = /<script src="([^"]+)" defer><\/script>/.exec(index);
if (!tag) throw new Error("no entry <script> in index.html");
const loader = await transform(
  (await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "worker", "loader.js"), "utf8"))
    .replaceAll("__MT_VERSION__", JSON.stringify(id))
    .replaceAll("__MT_ENTRY__", JSON.stringify(tag[1])),
  { minify: true, target: "es2020" },
);
index = index.replace(tag[0], `<script>${loader.code.replace(/<\/script/gi, "<\\/script")}</script>`);
await writeFile(indexPath, index);

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
const kb = Math.round(files.reduce((n, f) => n + f.bytes, 0) / 1024);
console.log(`sw.js and the loader: build ${id}; files.json lists ${files.length} files, ${kb} KB; precaching ${shell.join(", ")}`);
