/*
 *  Description: What the visitor is actually waiting for, with its sizes.
 *
 *               The launcher's progress bar is a percentage OF something, and until now that
 *               something was one file out of ten megabytes — so the bar sat at 0, jumped, and sat
 *               at 100 while the engine and the fonts came down unannounced. This is the list of
 *               everything the first frame needs, measured on disk.
 *
 *               Sizes are the files' own, not what the wire carries: a compressed response's
 *               Content-Length counts compressed bytes while a stream reader hands over
 *               decompressed ones, and a bar comparing those two units reaches 99% immediately.
 *
 *               NOTICES is deliberately absent (1.3MB of licences that nothing needs to paint a
 *               frame), and so is the engine variant this browser will not choose.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 */

import { readdir, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Flutter's own test for the Chromium engine build, written as an expression the launcher can
 * evaluate — `hasChromiumBreakIterators && hasImageCodecs` in flutter.js. Mirrored rather than
 * guessed from the user agent, because a guess that is wrong downloads five megabytes nobody wants
 * and leaves the five megabytes that were wanted outside the progress bar.
 */
const CHROMIUM =
  '(typeof Intl !== "undefined" && typeof Intl.v8BreakIterator !== "undefined" && typeof ImageDecoder !== "undefined")';

/** Everything the first frame needs, in the order it is worth having. */
async function candidates(dist) {
  const fonts = await fontFiles(dist);
  return [
    { file: "main.dart.js" },
    { file: "flutter.js" },
    { file: "assets/FontManifest.json" },
    { file: "assets/AssetManifest.bin.json" },
    { file: "assets/AssetManifest.bin" },
    ...fonts.map((file) => ({ file })),
    { file: "canvaskit/chromium/canvaskit.js", when: CHROMIUM },
    { file: "canvaskit/chromium/canvaskit.wasm", when: CHROMIUM },
    { file: "canvaskit/canvaskit.js", when: `!${CHROMIUM}` },
    { file: "canvaskit/canvaskit.wasm", when: `!${CHROMIUM}` },
  ];
}

async function fontFiles(dist) {
  const root = path.join(dist, "assets", "fonts");
  try {
    const entries = await readdir(root, { recursive: true, withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && /\.(ttf|otf)$/i.test(e.name))
      .map((e) => path.posix.join("assets/fonts", path.relative(root, path.join(e.parentPath ?? e.path, e.name))))
      .sort();
  } catch {
    return [];
  }
}

/** The preload list, as the launcher wants it: absolute paths, sizes, and any condition. */
export async function preloadFor(dist) {
  const out = [];
  for (const entry of await candidates(dist)) {
    try {
      const { size } = await stat(path.join(dist, entry.file));
      out.push({ url: `/${entry.file}`, bytes: size, ...(entry.when ? { when: entry.when } : {}) });
    } catch {
      // A build that does not contain it is a build that will not ask for it. Silence is right:
      // the engine ships variants that come and go between Flutter versions.
    }
  }
  return out;
}
