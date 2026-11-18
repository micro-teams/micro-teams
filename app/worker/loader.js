/*
 * The loader: the one script in the web document, run before the app. Built into index.html by
 * tool/build-worker.mjs with __MT_VERSION__ and __MT_ENTRY__ filled in.
 *
 * It reads files.json — this build's version and every file the first screen needs, with sizes —
 * and keeps those files in the Cache Storage cache named after the version. A cache under any other
 * version is deleted: the version (VERSION-commit) is the one key that cannot be wrong about whether
 * a file belongs to this build. Only the files not already cached are downloaded, and the splash
 * shows the share of THOSE bytes received so far, so a visit after the first one is at 100% at
 * once. The fonts are registered from the cached bytes and the entry script is run from the cache,
 * so nothing is fetched twice; the service worker (worker/sw.ts) answers from the same cache.
 *
 * Anything going wrong — no Cache Storage, a file that will not download — falls back to loading
 * the entry script and the fonts the ordinary way: a loader must never be why the app does not
 * start.
 */
/* global __MT_VERSION__, __MT_ENTRY__ */
(function () {
  let VERSION = __MT_VERSION__;
  let ENTRY = __MT_ENTRY__;
  let BASE = "/app/";
  let FONTS = [
    { family: "LiberationMono", path: "fonts/LiberationMono-Regular.ttf", desc: { weight: "400" } },
    { family: "LiberationMono", path: "fonts/LiberationMono-Bold.ttf", desc: { weight: "700" } },
    {
      family: "MT Noto Sans SC",
      path: "fonts/NotoSansSC-Regular.otf",
      desc: {
        unicodeRange:
          "U+2E80-2FDF, U+3000-303F, U+3040-30FF, U+3100-312F, U+31A0-31FF, U+3400-4DBF, U+4E00-9FFF, U+F900-FAFF, U+FE30-FE4F, U+FF00-FFEF, U+20000-2FA1F",
      },
    },
  ];

  function show(text) {
    let el = document.getElementById("mt-splash-word");
    if (el) el.textContent = text;
  }

  function run(src) {
    let s = document.createElement("script");
    s.src = src;
    document.body.appendChild(s);
  }

  function fontsTheOrdinaryWay() {
    let css = FONTS.map(function (f) {
      return (
        '@font-face{font-family:"' + f.family + '";font-display:swap;' +
        (f.desc.weight ? "font-weight:" + f.desc.weight + ";" : "") +
        (f.desc.unicodeRange ? "unicode-range:" + f.desc.unicodeRange + ";" : "") +
        'src:url("' + BASE + f.path + '")}'
      );
    }).join("");
    let style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
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

  async function load() {
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
    async function worker() {
      while (queue.length) {
        await download(cache, queue.shift(), function (n) {
          got += n;
          show(Math.min(99, Math.floor((got * 100) / total)) + "%");
        });
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()]);
    show("100%");
    for (let k = 0; k < FONTS.length; k++) {
      let cached = await cache.match(BASE + FONTS[k].path);
      if (!cached) throw new Error("font " + FONTS[k].path + " not cached");
      let face = new FontFace(FONTS[k].family, await cached.arrayBuffer(), FONTS[k].desc);
      document.fonts.add(face);
      void face.load();
    }
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
