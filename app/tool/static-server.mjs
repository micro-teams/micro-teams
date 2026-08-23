/*
 *  Description: A static file server that behaves like the nginx in front of production.
 *
 *               One rule matters and it is the reason this exists rather than `python3 -m
 *               http.server`: an unknown path falls back to index.html, the way
 *               `try_files $uri $uri/ /index.html` does in deploy/nginx.conf. Without it every deep
 *               link 404s, and someone concludes the app's routing is broken when it is the file
 *               server that is wrong.
 *
 *               It also answers /api and /mt with a FAKE backend — just enough of one to boot a
 *               signed-in session, open a conversation and post a message. That is here because
 *               the bug that survived every unit test was "the send button does nothing", and the
 *               only place that could be seen was a real browser running the real release build.
 *               What it is not is a substitute for the e2e against the real server: it knows
 *               nothing about permissions or teams, only about shapes.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
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

/** Everything the fake backend remembers: the messages posted to it. */
const posted = [];

// A conversation with a history, for measuring what scrolling one costs. Off by default: every
// other check wants a conversation it can read at a glance.
const history = Number(process.env.FAKE_MESSAGES ?? 0);
for (let i = 0; i < history; i++) {
  posted.push({
    id: i + 1,
    threadId: 5,
    senderId: i % 3 === 0 ? 1 : 2,
    content:
      i % 5 === 0
        ? `第 ${i} 条消息，中文与 English mixed，长到要换行：${"字".repeat(40)}`
        : `message ${i} — ordinary length, the sort of thing people actually send`,
    createdAt: new Date(Date.UTC(2026, 7, 21, 0, 0, i)).toISOString(),
    clientToken: null,
  });
}

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
  });
  res.end(text);
}

const page = { page_start: 1, page_size: 50, has_prev: false, has_more: false };
const me = {
  id: 1,
  username: "prober",
  nickname: "Prober",
  avatarId: 0,
  intro: "",
};

/**
 * Answers the calls the app makes on the way to a conversation, and takes a message.
 *
 * Anything it has no opinion about is a 404 rather than a hopeful empty object: a fake that
 * answers everything teaches a check that every call succeeds.
 */
async function backend(req, res) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const call = `${req.method} ${url.pathname}`;

  // cheese-auth. The app boots by refreshing, so this is the first call of any session.
  if (url.pathname.startsWith("/api/")) {
    if (call === "POST /api/users/auth/refresh-token") {
      return json(res, 200, { data: { user: me, accessToken: "probe-token" } });
    }
    if (call === "GET /api/users/me") return json(res, 200, { data: { user: me } });
    return json(res, 404, { message: `no fake for ${call}` });
  }

  switch (call) {
    case "GET /mt/team":
      return json(res, 200, { teams: [{ id: 1, name: "Probe Team" }], page });
    case "GET /mt/chat":
      return json(res, 200, {
        chats: [
          {
            id: 5,
            title: "现场 probe",
            updatedAt: "2026-08-21T00:00:00Z",
            members: [{ userId: 1, nickname: "Prober" }],
          },
        ],
        page,
      });
    case "GET /mt/chat/5":
      return json(res, 200, {
        thread: { id: 5, title: "现场 probe", createdAt: "2026-08-21T00:00:00Z" },
        members: [
          {
            id: 1,
            threadId: 5,
            userId: 1,
            role: "OWNER",
            joinedAt: "2026-08-21T00:00:00Z",
            nickname: "Prober",
          },
        ],
      });
    case "GET /mt/chat/5/messages":
      return json(res, 200, { messages: posted, page });
    case "POST /mt/chat/5/messages": {
      const body = await new Promise((resolve) => {
        let text = "";
        req.on("data", (chunk) => (text += chunk));
        req.on("end", () => resolve(text));
      });
      const sent = JSON.parse(body || "{}");
      const message = {
        id: posted.length + 1,
        threadId: 5,
        senderId: 1,
        content: sent.content ?? "",
        createdAt: new Date().toISOString(),
        clientToken: sent.clientToken ?? null,
      };
      posted.push(message);
      return json(res, 201, message);
    }
    case "GET /mt/agent":
      return json(res, 200, { agents: [], page });
    case "GET /mt/machine":
      return json(res, 200, { machines: [], page });
    case "GET /mt/lines":
      // Two lines, not one: with a single line every ranking question has the same answer, so a
      // client that never measured anything would look exactly like one that did. The second is
      // this same server under its absolute URL — enough for the client to have to resolve a URL
      // and send a real probe to it.
      return json(res, 200, {
        lines: [
          { id: "origin", url: "", transport: "same-origin", weight: 100 },
          // localhost rather than 127.0.0.1, so it is a genuinely different ORIGIN to the browser
          // — the probe has to be a cross-origin request, which is what a real second line is.
          { id: "second", url: `http://localhost:${port}`, transport: "direct", weight: 90 },
        ],
      });

    // What a probe asks for. 204 because the answer's only content is that it arrived.
    case "GET /mt/probe":
      res.writeHead(204, {
        "Cache-Control": "no-store",
        // As the deployment's nginx answers a probe from another line's host.
        "Access-Control-Allow-Origin": req.headers.origin ?? "*",
      });
      return res.end();
    default:
      return json(res, 404, { message: `no fake for ${call}` });
  }
}

const server = createServer(async (req, res) => {
  const requestPath = (req.url ?? "/").split("?")[0];
  if (requestPath.startsWith("/api/") || requestPath.startsWith("/mt/")) {
    return backend(req, res);
  }

  // As nginx serves it: never stored. It is the one thing a cached client asks in order to find out
  // that it is a cached client, and an answer about the past would defeat the whole arrangement.
  if (requestPath === "/version") {
    try {
      const body = await readFile(path.join(root, "version"), "utf8");
      res.writeHead(200, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
      res.end(body);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
      res.end("no version");
    }
    return;
  }

  const file = await resolve(req.url ?? "/");
  try {
    const info = await stat(file);
    // The same rules nginx serves under, because the checks here measure caching: an ETag with
    // `no-cache` means "ask me, and I will usually say 304" — which is what makes a warm visit cost
    // a round trip rather than a re-download. A blanket `no-store` would have made every measure-
    // ment here a measurement of a server that nobody deploys.
    const etag = `"${info.size.toString(16)}-${info.mtimeMs.toString(16)}"`;
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, { ETag: etag, "Cache-Control": "no-cache" });
      res.end();
      if (process.env.LOG_REQUESTS) console.log(`served 304 ${requestPath} 0`);
      return;
    }
    if (process.env.LOG_REQUESTS) {
      console.log(`served 200 ${requestPath} ${info.size}`);
    }
    res.writeHead(200, {
      "Content-Type": types[path.extname(file)] ?? "application/octet-stream",
      "Content-Length": info.size,
      ETag: etag,
      "Cache-Control": "no-cache",
    });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  }
});

/**
 * Accept the updates socket, and then say nothing.
 *
 * Enough of a WebSocket to complete the handshake, because a failed one is a console error on
 * every page and drowns the errors a check is actually looking for. What travels over it is the
 * sync layer's business, and no fake here can stand in for that.
 */
server.on("upgrade", (req, socket) => {
  const key = req.headers["sec-websocket-key"];
  if (!key) return socket.destroy();
  const accept = createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
});

server.listen(port, "127.0.0.1", () => {
  console.log(`serving ${root} on http://127.0.0.1:${port}`);
});
