/*
 * The shipped bundle, behind the shipped gateway, in a browser: is everything where it is served?
 *
 * `tsx bundle.ts <origin>` — run against the stack stack.sh brings up (deploy/nginx.conf in front
 * of the assembled tree). Prints each check and exits non-zero if any failed.
 *
 * Example: npx tsx bundle.ts http://localhost
 *
 * The journey asks whether the app works; this asks whether it works where it is served, which
 * stopped being the same question when the site took "/" and the app moved under "/app/":
 *   - the site answers "/", serves its pages, links to the app, and loads nothing from another
 *     origin (a page waiting on somebody else's host never finishes loading when that host stops
 *     answering); an unknown path at the root is a real 404, not the app;
 *   - the app opens at /app/ and at deep links one and two segments down (nginx falls back to the
 *     document; the document must still find its scripts from there), without page errors;
 *   - its service worker is scoped to /app/, never in front of the site;
 *   - every file the first screen needs that is named by its content is under /app/_expo/static/
 *     and may be kept for a year; the names that do not change are kept only by asking (no-cache),
 *     and a missing static file is a 404, never the document;
 *   - /version still answers at the origin root, where every other client asks for it.
 */
import { chromium } from "playwright";

const origin = (process.argv[2] ?? "http://localhost").replace(/\/$/, "");
let failed = 0;
function check(what: string, ok: boolean, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed += 1;
}

async function main() {
  const browser = await chromium.launch();
  try {
    // The site.
    {
      const page = await browser.newPage();
      const elsewhere: string[] = [];
      page.on("request", (r) => {
        if (!r.url().startsWith(`${origin}/`)) elsewhere.push(r.url());
      });
      const res = await page.goto(`${origin}/`, { waitUntil: "load" });
      check("the site answers /", res?.status() === 200, String(res?.status()));
      const login = await page
        .getAttribute("#login-link", "href")
        .catch(() => null);
      check(
        "its log-in link points at the app",
        login === "/app/",
        String(login),
      );
      for (const p of [
        "terms.html",
        "privacy.html",
        "contact.html",
        "about.html",
      ]) {
        const r = await page.goto(`${origin}/${p}`, { waitUntil: "load" });
        check(`the site serves ${p}`, r?.status() === 200, String(r?.status()));
      }
      const missing = await page.goto(`${origin}/no-such-page`, {
        waitUntil: "load",
      });
      check(
        "an unknown path at the root is a real 404",
        missing?.status() === 404,
        String(missing?.status()),
      );
      check(
        "the site loads nothing from another origin",
        elsewhere.length === 0,
        elsewhere.join(" ") || "none",
      );
      await page.close();
    }

    // The app, at its root and at depth.
    for (const path of ["/app/", "/app/agents", "/app/chats/206"]) {
      const page = await browser.newPage({
        viewport: { width: 390, height: 844 },
      });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      const res = await page.goto(`${origin}${path}`, { waitUntil: "load" });
      check(
        `${path} is served the app`,
        res?.status() === 200,
        String(res?.status()),
      );
      const shown = await page
        .getByTestId("go-register")
        .waitFor({ state: "visible", timeout: 20_000 })
        .then(
          () => true,
          () => false,
        );
      check(`the app opens at ${path}`, shown);
      check(
        `no page errors at ${path}`,
        errors.length === 0,
        errors.slice(0, 3).join(" | "),
      );
      if (path === "/app/") {
        const scope = await page
          .evaluate(async () => (await navigator.serviceWorker.ready).scope)
          .catch((e: unknown) => String(e));
        check(
          "the service worker is scoped to /app/",
          scope === `${origin}/app/`,
          String(scope),
        );
      }
      await page.close();
    }

    // How the app's files may be kept.
    const immutable = "public, max-age=31536000, immutable";
    const listed = (await (await fetch(`${origin}/app/files.json`)).json()) as { files: { path: string }[] };
    const statics = listed.files.map((f) => f.path).filter((p) => p.startsWith("_expo/static/"));
    check("files.json lists files under /app/_expo/static/", statics.length > 0, String(statics.length));
    for (const p of statics) {
      const r = await fetch(`${origin}/app/${p}`, { method: "HEAD" });
      check(`/app/${p} may be kept for a year`, r.status === 200 && r.headers.get("cache-control") === immutable, `${r.status} ${r.headers.get("cache-control")}`);
    }
    for (const p of ["/app/", "/app/index.html", "/app/chats/206", "/app/sw.js", "/app/files.json", "/app/manifest.json"]) {
      const r = await fetch(`${origin}${p}`, { method: "HEAD" });
      check(`${p} is kept only by asking`, r.status === 200 && r.headers.get("cache-control") === "no-cache", `${r.status} ${r.headers.get("cache-control")}`);
    }
    const gone = await fetch(`${origin}/app/_expo/static/js/web/index-0.js`, { method: "HEAD" });
    check("a missing static file is a 404 kept by nobody", gone.status === 404 && !gone.headers.get("cache-control"), `${gone.status} ${gone.headers.get("cache-control")}`);

    // The deployment's own endpoint.
    const version = await fetch(`${origin}/version`);
    const text = (await version.text()).trim();
    check(
      "/version answers at the origin root",
      version.status === 200 && text.length > 0,
      text,
    );
  } finally {
    await browser.close();
  }
}

main().then(
  () => {
    if (failed) {
      console.error(`${failed} check(s) failed`);
      process.exit(1);
    }
    console.log("bundle: all checks passed");
  },
  (e: unknown) => {
    console.error(e);
    process.exit(1);
  },
);
