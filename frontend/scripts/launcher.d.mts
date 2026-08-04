/*
 *  Description: Types for the build step, so the tests that exercise it are type-checked like
 *               everything else.
 *
 *               The script itself stays plain JavaScript: it runs under node as part of the build,
 *               and compiling a build step before it can build is a knot worth not tying. A hand-
 *               written declaration is the smaller price, and it is checked against reality by the
 *               tests that import it.
 *
 *  Author(s):
 *      agent3
 */

/** The startup set: what the app cannot open without, and where the launcher's own links come from. */
export function startupManifest(indexHtml: string): {
  entry: string;
  styles: string[];
  urls: string[];
};

/** A cache key that changes exactly when the cached bytes do. */
export function manifestVersion(entries: Array<[string, Uint8Array | Buffer]>): string;

/** Rewrite a finished vite build into a launcher-started one. Returns what it decided. */
export function build(
  dist: string,
  options?: { registry?: { lines: Array<{ id: string; url: string }> } },
): Promise<{ manifest: string[]; version: string }>;
