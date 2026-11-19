/*
 * Puts the installable clients into a deployment's static tree and writes the manifest that lists
 * them, so what the app offers for download and what is on disk cannot disagree.
 *
 *   node add-clients.mjs <dist> <version> <android apk> [signed]
 *
 * Copies the APK to <dist>/downloads/<version>/microteams-<version>-android.apk and writes
 * <dist>/downloads/clients.json:
 *   { "version": "...", "clients": [{ "platform": "android", "url": "...", "bytes": N, "signed": "release"|"debug" }] }
 * A missing APK is an error: a bundle that advertises a client it does not carry is a download
 * button that answers 404.
 */
import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const [dist, version, apk, signed = "debug"] = process.argv.slice(2);
if (!dist || !version || !apk) {
  console.error("usage: add-clients.mjs <dist> <version> <android apk> [signed]");
  process.exit(2);
}

const name = `microteams-${version}-android.apk`;
const into = path.join(dist, "downloads", version);
await mkdir(into, { recursive: true });
await copyFile(apk, path.join(into, name));
const bytes = (await stat(apk)).size;
const clients = [{ platform: "android", url: `/downloads/${version}/${name}`, bytes, signed }];
await writeFile(path.join(dist, "downloads", "clients.json"), `${JSON.stringify({ version, clients }, null, 2)}\n`);
console.log(`${clients[0].url} (${(bytes / 1048576).toFixed(1)} MB, ${signed}-signed)`);
