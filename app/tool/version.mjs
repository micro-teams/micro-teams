/*
 *  Description: The one version string this build is known by, everywhere it is asked.
 *
 *               `x.y.z-hash`: the product version from the repo-root VERSION file, plus the commit
 *               that produced the bundle. The product half is what a human says out loud; the hash
 *               is what makes two builds of the same version distinguishable, which is the half a
 *               cached browser actually needs.
 *
 *               CI passes it in, so the app bundle, the launcher, the service worker and /version
 *               all say the same thing by construction rather than by four separate calculations
 *               that agree until one of them is changed.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 */

import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export async function appVersion() {
  // CI computes it once for the whole pipeline; everything else here is for a local build, where
  // being exactly right matters less than being different from the last one.
  if (process.env.MT_VERSION) return process.env.MT_VERSION;

  const product = (await readFile(path.join(here, "..", "..", "VERSION"), "utf8")).trim();
  let commit = "dev";
  try {
    commit = execFileSync("git", ["rev-parse", "--short=7", "HEAD"], {
      cwd: here,
      encoding: "utf8",
    }).trim();
  } catch {
    // Not a checkout, or no git. A version without a commit is still a version.
  }
  return `${product}-${commit}`;
}
