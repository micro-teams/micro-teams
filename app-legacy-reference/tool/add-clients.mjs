/*
 *  Description: Puts the installable clients into the bundle, and says what they are.
 *
 *               A native client is installed rather than served, so somebody has to be able to GET
 *               it — and the honest place for it is beside the web app it belongs to, at the same
 *               version, from the same deployment. `/downloads/<version>/<file>` with the version
 *               in the PATH: a package is immutable once published, and a path that contains the
 *               version can never be shadowed by a stale copy of a different one.
 *
 *               `clients.json` is what the app reads. Nothing in the Dart code knows the name of an
 *               artefact — adding an architecture is a line in this file's output.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 */

import { copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { appVersion } from "./version.mjs";

const dist = path.resolve(process.argv[2] ?? "build/web");
const from = path.resolve(process.argv[3] ?? "build/app/outputs/flutter-apk");

/** How the packages were signed, as the build knows it — see android/app/build.gradle.kts. */
const signed = process.env.MT_APK_SIGNED ?? "debug";

/** Flutter's own names for what it produces, mapped to what a person calls it. */
const ARCHES = [
  { file: "app-arm64-v8a-release.apk", arch: "arm64" },
  { file: "app-armeabi-v7a-release.apk", arch: "arm32" },
  { file: "app-x86_64-release.apk", arch: "x86_64" },
  // A single package covering every architecture, when the build was not split.
  { file: "app-release.apk", arch: "universal" },
];

const version = await appVersion();
const into = path.join(dist, "downloads", version);
await mkdir(into, { recursive: true });

const clients = [];
for (const { file, arch } of ARCHES) {
  const source = path.join(from, file);
  let size;
  try {
    size = (await stat(source)).size;
  } catch {
    continue; // Not built this time. A missing architecture is a shorter list, not an error.
  }
  const name = `microteams-${version}-${arch}.apk`;
  await copyFile(source, path.join(into, name));
  clients.push({
    platform: "android",
    arch,
    url: `/downloads/${version}/${name}`,
    bytes: size,
    signed,
  });
}

await writeFile(
  path.join(dist, "downloads", "clients.json"),
  `${JSON.stringify({ version, clients }, null, 2)}\n`,
);

if (clients.length === 0) {
  console.log(`no clients found in ${from} — clients.json lists none`);
} else {
  for (const client of clients) {
    console.log(`${client.url} (${(client.bytes / 1048576).toFixed(1)} MB, ${client.signed}-signed)`);
  }
}

// Anything else that was left in the output directory is not ours to publish.
const strays = (await readdir(from).catch(() => [])).filter(
  (name) => name.endsWith(".apk") && !ARCHES.some((a) => a.file === name),
);
if (strays.length) console.log(`ignored: ${strays.join(", ")}`);
