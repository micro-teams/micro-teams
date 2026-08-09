/*
 *  Description: Rasterises public/favicon.svg into the PNG icons a Web App Manifest needs.
 *
 *               An installed app's icon is drawn by the OS, not the browser, and the platforms that
 *               matter still want PNG at fixed sizes — so these have to exist as files. They are
 *               generated rather than hand-exported so the day the logo changes, one command
 *               re-derives them and they cannot drift from the favicon everyone else sees.
 *
 *               Chromium does the rasterising because the project already carries it (the launcher
 *               check drives a real browser), and because the mark uses gaussian-blur filters that a
 *               naive SVG rasteriser renders differently — the browser's answer IS the right answer
 *               here, since a browser is what renders the favicon.
 *
 *               Run: npm run icons
 *
 *  Author(s):
 *      agent3
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, "..", "public");

/**
 * What each icon is for, and why the maskable one is padded.
 *
 * Android (and any launcher following the maskable spec) crops an icon to whatever shape the
 * platform likes — circle, squircle, rounded square — keeping only the middle 80%. An icon drawn
 * edge to edge therefore loses its corners. The maskable variant is drawn at 60% scale on a solid
 * background so nothing important can be cropped, which is why it is a separate file rather than
 * the same PNG declared twice.
 */
const ICONS = [
  { file: "icon-192.png", size: 192, scale: 1, background: "transparent" },
  { file: "icon-512.png", size: 512, scale: 1, background: "transparent" },
  // Same near-black as --background / the manifest's background_color, so the padding around the
  // mark is not a visible plate of a different colour on a dark launcher.
  { file: "icon-maskable-512.png", size: 512, scale: 0.6, background: "#060606" },
];

const page = (svg, size, scale, background) => `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html,body { margin:0; padding:0; }
  body { width:${size}px; height:${size}px; background:${background};
         display:flex; align-items:center; justify-content:center; }
  svg { width:${Math.round(size * scale)}px; height:auto; }
</style></head><body>${svg}</body></html>`;

const svg = await readFile(path.join(publicDir, "favicon.svg"), "utf8");
const browser = await chromium.launch();
try {
  for (const { file, size, scale, background } of ICONS) {
    const context = await browser.newContext({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    const tab = await context.newPage();
    await tab.setContent(page(svg, size, scale, background));
    const png = await tab.screenshot({
      omitBackground: background === "transparent",
      type: "png",
    });
    await writeFile(path.join(publicDir, file), png);
    await context.close();
    console.log(`icons: wrote public/${file} (${size}x${size})`);
  }
} finally {
  await browser.close();
}
