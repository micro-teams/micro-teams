/*
 *  Description: The bundle's nginx, in twenty lines: real files, SPA fallback to index.html, and a
 *               stub for the transport endpoints so the app's registry refresh has something to
 *               talk to.
 *
 *               Exists because the launcher can only be checked by a browser loading it over HTTP —
 *               a Service Worker does not register on file://, so nothing about this change can be
 *               verified without a server.
 *
 *  Author(s):
 *      agent3
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const dist = process.argv[2];
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };

const PORT = Number(process.env.PORT ?? 8931);

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/mt/lines") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ lines: [{ id: "origin", url: "", transport: null, weight: null, foreignOrigin: null }] }));
    return;
  }
  if (url.pathname.startsWith("/mt/")) { res.writeHead(204); res.end(); return; }
  let file = path.join(dist, url.pathname === "/" ? "index.html" : url.pathname.slice(1));
  try {
    if ((await stat(file)).isDirectory()) file = path.join(file, "index.html");
  } catch {
    file = path.join(dist, "index.html");
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": types[path.extname(file)] ?? "application/octet-stream",
      // What deploy/nginx.conf serves for static assets, and the reason it has to: the launcher
      // imports the entry module from whichever line won the race, and a cross-origin module import
      // without this header is refused by the browser.
      "access-control-allow-origin": "*",
    });
    res.end(body);
  } catch {
    res.writeHead(404); res.end("not found");
  }
}).listen(PORT, () => console.log(`serving ${dist} on ${PORT}`));
