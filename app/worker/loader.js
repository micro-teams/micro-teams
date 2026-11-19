/*
 * The loader: the one script in the web document, run before the app. Built into index.html by
 * tool/build-worker.mjs with __MT_VERSION__, __MT_ENTRY__ and __MT_FONTS__ (where the build put the
 * monospace faces and the Chinese face) filled in.
 *
 * It first makes sure the service worker (worker/sw.ts) controls the page: on a first visit it
 * registers it and waits for it to take the page, at most WORKER_WAIT_MS. Every download after
 * that goes through the worker, whose line router carries it over the fastest MultiPath line
 * rather than only the way the page itself came. A browser without a worker, or a worker that does
 * not take the page in time, gets the same downloads directly, and the console says so.
 *
 * It then reads files.json — this build's version and every file the first screen needs, with
 * sizes — and keeps those files in the Cache Storage cache named after the version. A cache under
 * any other version is deleted: the version (VERSION-commit) is the one key that cannot be wrong
 * about whether a file belongs to this build. Only the files not already cached are downloaded,
 * and the splash shows the share of THOSE bytes received so far, so a visit after the first one is
 * at 100% at once. The monospace faces are registered from the cached bytes and the entry script
 * is run from the cache, so nothing is fetched twice.
 *
 * The Chinese face is not part of the first screen: until it arrives Chinese is drawn in the
 * system's CJK font, the next one in the app's font stack. It is downloaded (and cached) once the
 * app has drawn its first screen (data-mt-ready on <html>), and swapped in when it is there.
 *
 * Anything going wrong — no Cache Storage, a file that will not download — falls back to loading
 * the entry script and the faces the ordinary way (the Chinese one still after the first screen):
 * a loader must never be why the app does not start.
 */
/* global __MT_VERSION__, __MT_ENTRY__, __MT_FONTS__ */
(function () {
  let VERSION = __MT_VERSION__;
  let ENTRY = __MT_ENTRY__;
  let PATHS = __MT_FONTS__;
  let BASE = "/app/";
  // Long enough for a slow line to bring the worker in (its script, then the document it keeps),
  // short enough that a browser whose worker never comes is not left at 0% for long.
  let WORKER_WAIT_MS = 10000;
  let FONTS = [
    { family: "LiberationMono", path: PATHS.mono, desc: { weight: "400" } },
    { family: "LiberationMono", path: PATHS.monoBold, desc: { weight: "700" } },
  ];
  let CJK = {
    family: "MT Noto Sans SC",
    path: PATHS.cjk,
    desc: {
      unicodeRange:
        "U+2E80-2FDF, U+3000-303F, U+3040-30FF, U+3100-312F, U+31A0-31FF, U+3400-4DBF, U+4E00-9FFF, U+F900-FAFF, U+FE30-FE4F, U+FF00-FFEF, U+20000-2FA1F",
    },
  };

  function show(text) {
    let el = document.getElementById("mt-splash-word");
    if (el) el.textContent = text;
  }

  function run(src) {
    let s = document.createElement("script");
    s.src = src;
    document.body.appendChild(s);
  }

  /** Resolves with "" once the service worker controls the page, or with why it does not. */
  function worker() {
    let sw = navigator.serviceWorker;
    if (!sw) return Promise.resolve("this browser has no service worker");
    if (sw.controller) return Promise.resolve("");
    return new Promise(function (resolve) {
      let timer = setTimeout(function () {
        resolve("the service worker did not take the page within " + WORKER_WAIT_MS + " ms");
      }, WORKER_WAIT_MS);
      sw.addEventListener("controllerchange", function () {
        clearTimeout(timer);
        resolve("");
      });
      sw.register(BASE + "sw.js", { scope: BASE }).catch(function (e) {
        clearTimeout(timer);
        resolve("the service worker could not be registered: " + e);
      });
    });
  }

  function fontsTheOrdinaryWay() {
    let css = FONTS.map(function (f) {
      return '@font-face{font-family:"' + f.family + '";font-display:swap;font-weight:' + f.desc.weight + ';src:url("' + BASE + f.path + '")}';
    }).join("");
    let style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    afterFirstScreen(function () {
      let face = new FontFace(CJK.family, 'url("' + BASE + CJK.path + '")', CJK.desc);
      document.fonts.add(face);
      face.load().then(cjkIn, cjkMissing);
    });
  }

  function cjkIn() {
    console.log("loader: the Chinese face is in");
  }

  function cjkMissing(e) {
    console.warn("loader: the Chinese face did not load (" + e + "); Chinese stays in the system's font");
  }

  async function download(cache, file, progress) {
    let res = await fetch(BASE + file.path, { cache: "no-cache" });
    if (!res.ok) throw new Error(file.path + " answered " + res.status);
    let type = res.headers.get("Content-Type") || "";
    let chunks = [];
    if (res.body && res.body.getReader) {
      let reader = res.body.getReader();
      for (;;) {
        let part = await reader.read();
        if (part.done) break;
        chunks.push(part.value);
        progress(part.value.length);
      }
    } else {
      let all = new Uint8Array(await res.arrayBuffer());
      chunks.push(all);
      progress(all.length);
    }
    await cache.put(BASE + file.path, new Response(new Blob(chunks, { type: type }), { headers: { "Content-Type": type } }));
  }

  /** Registers a face from its cached bytes, downloading them first if they are not cached. */
  async function addFace(cache, font) {
    if (!(await cache.match(BASE + font.path))) await download(cache, font, function () {});
    let cached = await cache.match(BASE + font.path);
    if (!cached) throw new Error("font " + font.path + " not cached");
    let face = new FontFace(font.family, await cached.arrayBuffer(), font.desc);
    document.fonts.add(face);
    await face.load();
  }

  function afterFirstScreen(then) {
    let root = document.documentElement;
    if (root.dataset.mtReady === "1") return then();
    let watch = new MutationObserver(function () {
      if (root.dataset.mtReady !== "1") return;
      watch.disconnect();
      then();
    });
    watch.observe(root, { attributes: true, attributeFilter: ["data-mt-ready"] });
  }

  async function load() {
    let without = await worker();
    if (without) console.warn("loader: " + without + "; downloading directly");
    if (!("caches" in window)) throw new Error("no Cache Storage");
    let name = "microteams-" + VERSION;
    let names = await caches.keys();
    for (let i = 0; i < names.length; i++) {
      if (names[i].indexOf("microteams-") === 0 && names[i] !== name && names[i] !== "microteams-lines") await caches.delete(names[i]);
    }
    let cache = await caches.open(name);
    let manifest = await (await fetch(BASE + "files.json", { cache: "no-store" })).json();
    // A document from one build and a manifest from the next (a deploy between the two requests):
    // go on with what this document names, and let the next visit pick the new build up whole.
    let files = manifest.version === VERSION ? manifest.files : [];
    let missing = [];
    for (let j = 0; j < files.length; j++) if (!(await cache.match(BASE + files[j].path))) missing.push(files[j]);
    let total = missing.reduce(function (n, f) { return n + f.bytes; }, 0);
    let got = 0;
    show(total ? "0%" : "100%");
    let queue = missing.slice();
    async function fetcher() {
      while (queue.length) {
        await download(cache, queue.shift(), function (n) {
          got += n;
          show(Math.min(99, Math.floor((got * 100) / total)) + "%");
        });
      }
    }
    await Promise.all([fetcher(), fetcher(), fetcher(), fetcher()]);
    show("100%");
    for (let k = 0; k < FONTS.length; k++) await addFace(cache, FONTS[k]);
    afterFirstScreen(function () {
      addFace(cache, CJK).then(cjkIn, cjkMissing);
    });
    let entry = await cache.match(ENTRY);
    // Under the worker the entry is answered from this cache anyway; without one, it runs from the
    // cached bytes rather than being downloaded a second time.
    if (navigator.serviceWorker && navigator.serviceWorker.controller) return ENTRY;
    return entry ? URL.createObjectURL(await entry.blob()) : ENTRY;
  }

  load().then(run, function (e) {
    console.warn("loader: " + e + "; loading the ordinary way");
    fontsTheOrdinaryWay();
    run(ENTRY);
  });
})();
