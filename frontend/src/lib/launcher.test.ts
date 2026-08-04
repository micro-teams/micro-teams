// The two decisions the build step makes that a library cannot: what is worth precaching, and what
// counts as a version. Both are quiet when wrong — a manifest missing something shows up only when
// somebody opens the app offline, and a version that does not move leaves users on the old build
// after a deploy.
//
// Whether any of it actually works in a browser is a different question, and one these cannot
// answer. That is scripts/launcher-check.mjs.

import { describe, expect, it } from "vitest";

import { manifestVersion, startupManifest } from "../../scripts/launcher.mjs";

const INDEX = `<!doctype html>
<html lang="en">
  <head>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <title>MicroTeams</title>
    <script type="module" crossorigin src="/assets/index-Dr1UTpes.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/index-CU0iHlG7.css">
  </head>
  <body><div id="root"></div></body>
</html>`;

describe("the startup manifest", () => {
  it("takes the entry module and the stylesheet from what the build emitted", () => {
    const { entry, styles, urls } = startupManifest(INDEX);

    expect(entry).toBe("/assets/index-Dr1UTpes.js");
    expect(styles).toEqual(["/assets/index-CU0iHlG7.css"]);
    expect(urls).toContain("/assets/index-Dr1UTpes.js");
    expect(urls).toContain("/assets/index-CU0iHlG7.css");
  });

  // Found by a browser, not by reading the code: with every asset cached but the document missing,
  // an offline start has nothing to open and the whole precache is useless.
  it("includes the document itself", () => {
    expect(startupManifest(INDEX).urls[0]).toBe("/");
  });

  // The icons are referenced by the shell, so they belong; the lazily-loaded chunks are most of the
  // 6.6MB the build emits and none of them is needed to start.
  it("is the startup set rather than everything", () => {
    const { urls } = startupManifest(INDEX);

    expect(urls).toContain("/favicon.svg");
    expect(urls).toContain("/icons.svg");
    expect(urls).toHaveLength(5);
  });

  // A build that changed shape must not silently produce a launcher pointing at nothing.
  it("refuses an index.html with no entry script", () => {
    expect(() =>
      startupManifest("<html><body>nothing here</body></html>"),
    ).toThrow(/entry script/);
  });
});

describe("the version", () => {
  const bytes = (s: string) => new TextEncoder().encode(s);

  it("changes when the cached bytes change", () => {
    const before = manifestVersion([["/a.js", bytes("one")]]);
    const after = manifestVersion([["/a.js", bytes("two")]]);

    expect(after).not.toBe(before);
  });

  // The half that matters on a deploy that changed nothing: an unstable version would throw away a
  // good cache every time, which is the same cost as having no cache at all.
  it("does not change when nothing did", () => {
    const entries: Array<[string, Uint8Array]> = [
      ["/a.js", bytes("one")],
      ["/b.css", bytes("two")],
    ];

    expect(manifestVersion(entries)).toBe(manifestVersion(entries));
  });

  // Same bytes under a different name is a different build: the cache is keyed by URL too.
  it("distinguishes the same bytes at a different url", () => {
    expect(manifestVersion([["/a.js", bytes("x")]])).not.toBe(
      manifestVersion([["/b.js", bytes("x")]]),
    );
  });
});
