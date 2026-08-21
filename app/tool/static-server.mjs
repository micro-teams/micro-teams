/*
 *  Description: A static file server that behaves like the nginx in front of production.
 *
 *               One rule matters and it is the reason this exists rather than `python3 -m
 *               http.server`: an unknown path falls back to index.html, the way
 *               `try_files $uri $uri/ /index.html` does in deploy/nginx.conf. Without it every deep
 *               link 404s, and someone concludes the app's routing is broken when it is the file
 *               server that is wrong.
 *
 *               It is NOT nginx, and the difference is worth knowing: nginx also proxies /api and
 *               /mt to the backends, which is why the browser check here can exercise the shell,
 *               the worker and the routes, but not a signed-in session. That belongs to the e2e.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? "build/web");
const port = Number(process.env.PORT ?? 8931);

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".ico": "image/x-icon",
  ".bin": "application/octet-stream",
  ".symbols": "text/plain; charset=utf-8",
};

async function resolve(urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0]);
  const candidate = path.join(root, path.normalize(clean));
  // Never serve outside the root, however creative the path is.
  if (!candidate.startsWith(root)) return path.join(root, "index.html");
  try {
    const info = await stat(candidate);
    if (info.isDirectory()) return path.join(candidate, "index.html");
    return candidate;
  } catch {
    return path.join(root, "index.html");
  }
}

createServer(async (req, res) => {
  const file = await resolve(req.url ?? "/");
  try {
    const info = await stat(file);
    res.writeHead(200, {
      "Content-Type": types[path.extname(file)] ?? "application/octet-stream",
      "Content-Length": info.size,
      // The service worker is the thing under test; a cached copy of it would test yesterday.
      "Cache-Control": "no-store",
    });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`serving ${root} on http://127.0.0.1:${port}`);
});
