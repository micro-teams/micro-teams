/*
 *  Description: Every icon this product ships, from the one file that is the mark.
 *
 *               A favicon, four web icons and five Android densities is ten files that must all say
 *               the same thing. Kept by hand, they drift — one of them is the old mark for a year
 *               and nobody notices, because nobody looks at a 48px icon twice. So they are
 *               generated, and the generator is run by the build.
 *
 *               Rasterised with the browser that is already here for the checks, rather than by
 *               adding an image toolchain: the thing that will render these icons in the end IS a
 *               browser, so the pixels are the ones the browser would have produced anyway.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 */

import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const mark = await readFile(path.join(app, "branding", "logo.svg"), "utf8");

/** The web's own set. */
const web = [
  ["web/icon-192.png", 192],
  ["web/icon-512.png", 512],
];

/**
 * The maskable icon is a different drawing, not the same one at another size.
 *
 * A launcher may crop it to a circle, so the colour has to run to the edge — a rounded tile inside a
 * circular mask leaves four bald corners — and the mark has to sit inside the middle 80%, which is
 * the only part guaranteed to survive. Made from the same source by taking the tile off and putting
 * the contents back smaller.
 */
function maskable(source) {
  const inner = source.replace(/<rect[^>]*rx="112"[^>]*\/>/, "");
  const body = inner.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>[\s\S]*$/, "");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">` +
    `<rect width="512" height="512" fill="#07C160"/>` +
    `<g transform="translate(256 256) scale(0.72) translate(-256 -256)">${body}</g></svg>`
  );
}

/**
 * Android's launcher densities. The adaptive icon (v26 and later) is drawn from vectors instead —
 * see res/mipmap-anydpi-v26 — so these are what older launchers fall back to.
 */
const android = [
  ["android/app/src/main/res/mipmap-mdpi/ic_launcher.png", 48],
  ["android/app/src/main/res/mipmap-hdpi/ic_launcher.png", 72],
  ["android/app/src/main/res/mipmap-xhdpi/ic_launcher.png", 96],
  ["android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png", 144],
  ["android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png", 192],
];

const browser = await chromium.launch();
const page = await browser.newPage();

async function render(file, size, source) {
  const target = path.join(app, file);
  await mkdir(path.dirname(target), { recursive: true });
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;padding:0;background:transparent}svg{display:block}</style>` +
      source.replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`),
  );
  await writeFile(target, await page.locator("svg").screenshot({ omitBackground: true }));
  console.log(`${file} ${size}px`);
}

for (const [file, size] of [...web, ...android]) await render(file, size, mark);
await render("web/icon-maskable-512.png", 512, maskable(mark));

/**
 * Android's adaptive icon, drawn from the same file as everything else.
 *
 * A vector rather than a picture, because a launcher scales it to whatever the device wants — and
 * generated rather than hand-copied, because a hand-copied mark is a second mark that agrees with
 * the first only until somebody edits one of them.
 *
 * Two things Android's vector format does not have: circles and rounded rectangles. They become
 * paths here. What it does have is a group with a transform, which is what keeps the coordinates
 * below identical to the source's — the mark is placed inside the middle 62% of the 108dp canvas,
 * which is the region no launcher mask will crop.
 */
function androidVector(source) {
  const shapes = [];
  const push = (fill, d) => shapes.push({ fill, d });

  const circle = /<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"\s*\/>/g;
  const rect = /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="([\d.]+)"\s*\/>/g;
  const path = /<path d="([^"]+)"\s*\/>/g;

  // The source groups shapes by fill, which is how the colour is known for each shape.
  for (const group of source.matchAll(/<g fill="(#[0-9A-Fa-f]{6})">([\s\S]*?)<\/g>/g)) {
    const [, fill, body] = group;
    for (const [, cx, cy, r] of body.matchAll(circle)) {
      push(fill, `M${cx},${cy} m-${r},0 a${r},${r} 0 1,0 ${r * 2},0 a${r},${r} 0 1,0 -${r * 2},0 Z`);
    }
    for (const [, x, y, w, h, rx] of body.matchAll(rect)) {
      const [X, Y, W, H, R] = [+x, +y, +w, +h, +rx];
      push(
        fill,
        `M${X + R},${Y} L${X + W - R},${Y} A${R},${R} 0 0,1 ${X + W},${Y + R} ` +
          `L${X + W},${Y + H - R} A${R},${R} 0 0,1 ${X + W - R},${Y + H} ` +
          `L${X + R},${Y + H} A${R},${R} 0 0,1 ${X},${Y + H - R} ` +
          `L${X},${Y + R} A${R},${R} 0 0,1 ${X + R},${Y} Z`,
      );
    }
    for (const [, d] of body.matchAll(path)) push(fill, d);
  }
  // The bubble itself is a bare path with its own fill attribute, outside any group.
  for (const [, d, fill] of source.matchAll(/<path d="([^"]+)" fill="(#[0-9A-Fa-f]{6})"\/>/g)) {
    shapes.unshift({ fill, d });
  }

  // 0.8 rather than the 0.66 the safe zone allows: the source has a tile with its own padding, and
  // that padding is dropped here — scaled to the safe zone as if it were still there, the mark
  // would sit in the middle of a large empty square and read as a small icon on a big background.
  const scale = (108 * 0.8) / 512;
  const offset = (108 - 512 * scale) / 2;
  return `<?xml version="1.0" encoding="utf-8"?>
<!--
    Generated by tool/icons.mjs from branding/logo.svg. Do not edit: the next build overwrites it.

    The mark sits inside the middle 62% of Android's 108dp canvas, which is the part a launcher's
    mask is guaranteed to keep. The background is a flat colour (see mipmap-anydpi-v26).
-->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <group
        android:scaleX="${scale.toFixed(6)}"
        android:scaleY="${scale.toFixed(6)}"
        android:translateX="${offset.toFixed(4)}"
        android:translateY="${offset.toFixed(4)}">
${shapes
  .map(
    (shape) =>
      `        <path\n            android:fillColor="${shape.fill}"\n            android:pathData="${shape.d.replace(/\s+/g, " ").trim()}" />`,
  )
  .join("\n")}
    </group>
</vector>
`;
}

await writeFile(
  path.join(app, "android/app/src/main/res/drawable/ic_launcher_foreground.xml"),
  androidVector(mark),
);
console.log("android adaptive foreground (vector, from the same file)");

// The favicon is the mark itself: an SVG favicon is sharp at every size a browser asks for, and it
// is the same bytes as the source rather than a copy that can fall behind it.
await writeFile(path.join(app, "web", "favicon.svg"), mark);
console.log("web/favicon.svg (the mark itself)");

await browser.close();
