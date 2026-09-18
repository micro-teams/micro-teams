/*
 *  Description: Lays the web build and the marketing site out the way a deployment serves them.
 *
 *               There is exactly one description of that layout and this is it. It used to live in
 *               the workflow's assembly step, which meant the only thing that ever saw the real
 *               layout was a production deploy: every browser check ran against `build/web` served
 *               at the root, which is NOT what anybody is served. T-093 is what that costs — the
 *               app moved under /app/, every HTTP status was right, and the app itself opened onto
 *               go_router's "no routes for location: /app" error page, because a document's idea of
 *               where it is comes from its <base>, not from nginx. So: one function, called by the
 *               workflow that ships the bundle AND by tool/check-bundle.sh, which opens the result
 *               in a real browser behind the real deploy/nginx.conf.
 *
 *               The layout:
 *                 <dist>/app/      everything `flutter build web` produced, entry documents,
 *                                  service worker, engine, assets and all. It is one tree and it
 *                                  moves as one tree: the documents resolve everything else
 *                                  against their own <base href>, which this function points at
 *                                  /app/, so the only arrangement that works is the one where
 *                                  they stay together.
 *                 <dist>/version   NOT under /app/. It answers "what is deployed?" about the whole
 *                                  deployment, ops curls it by that name, and the Dart client asks
 *                                  for it at the origin root (lib/src/common/server_version.dart).
 *                 <dist>/*.html    the marketing site (site/), which takes "/".
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 */

import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

/** Files in site/ that are for whoever reads the repository, not for whoever visits the site. */
const SITE_NOT_SHIPPED = new Set(["README.md"]);

/** Where a deployment serves the app from. The site takes "/" — see deploy/nginx.conf. */
const MOUNT = "/app/";

/** The two documents that carry a <base href>: the launcher, and Flutter's own, kept beside it. */
const DOCUMENTS = ["index.html", "app.html"];

/**
 * Points the app's documents at where they are about to be served from.
 *
 * This single line is the only thing in the whole tree that has to know the mount point, and that
 * is by design: everything else the documents reference is relative to their base, so it follows.
 * It is also the line T-093 was missing. `flutter build web` cannot write it — it runs long before
 * anything is assembled — and leaving it at "/" while serving from /app/ does not fail loudly: the
 * assets still load, go_router is simply handed the location "/app", matches nothing, and renders
 * its own error page behind a 200. tool/check-bundle.sh opens the result of this function in a real
 * browser for exactly that reason.
 */
async function mountDocumentsAt(appDir, mount) {
  for (const document of DOCUMENTS) {
    const file = path.join(appDir, document);
    const before = await readFile(file, "utf8");
    const after = before.replace('<base href="/">', `<base href="${mount}">`);
    if (after === before) {
      throw new Error(`${document} has no <base href="/"> to point at ${mount}`);
    }
    await writeFile(file, after, "utf8");
  }
}

async function isDirectory(candidate) {
  try {
    return (await stat(candidate)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Builds `dist` from a finished web build and the marketing site.
 *
 * `webBuild` is consumed by copying, never by moving, so a caller can assemble twice from the same
 * build — which tool/check-bundle.sh does, and which a half-moved tree would make impossible to
 * debug.
 */
export async function assembleDist({ webBuild, site, dist }) {
  if (!(await isDirectory(webBuild))) throw new Error(`no web build at ${webBuild}`);

  await rm(dist, { recursive: true, force: true });
  await mkdir(path.join(dist, "app"), { recursive: true });
  await cp(webBuild, path.join(dist, "app"), { recursive: true });
  await mountDocumentsAt(path.join(dist, "app"), MOUNT);

  const version = path.join(dist, "app", "version");
  if (await isDirectory(path.dirname(version))) {
    try {
      await rename(version, path.join(dist, "version"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  if (site && (await isDirectory(site))) {
    for (const entry of await readdir(site, { withFileTypes: true })) {
      if (!entry.isFile() || SITE_NOT_SHIPPED.has(entry.name)) continue;
      await cp(path.join(site, entry.name), path.join(dist, entry.name));
    }
  }
  return dist;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [webBuild, site, dist] = process.argv.slice(2);
  if (!webBuild || !dist) {
    console.error("usage: assemble-dist.mjs <web-build> <site-dir|-> <dist-out>");
    process.exit(2);
  }
  await assembleDist({ webBuild, site: site === "-" ? null : site, dist });
  console.log(`assembled ${dist}: the app under /app/, the site at /`);
}
