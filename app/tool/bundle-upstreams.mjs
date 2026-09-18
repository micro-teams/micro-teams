/*
 *  Description: The two upstreams deploy/nginx.conf proxies to, faked, for the bundle check.
 *
 *               Not a second fake backend: tool/static-server.mjs is the one that knows the shapes,
 *               and this is deliberately thinner. The bundle check asks one question — does the
 *               shipped layout, behind the shipped gateway, actually start the app and route it —
 *               and the only thing that needs to be true for that question to be askable is that a
 *               session exists. A signed-OUT app redirects to /login before go_router ever matches
 *               the incoming location, which is exactly how T-093 stayed invisible: the failure
 *               only appears for somebody who is signed in.
 *
 *               It answers at the ROOT, not under /api and /mt, because nginx strips those prefixes
 *               before proxying (`proxy_pass http://cheese-auth:8091/`). Getting that backwards
 *               makes every call 404 and the check fails for the wrong reason.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 */

import { createServer } from "node:http";

const AUTH_PORT = Number(process.env.AUTH_PORT ?? 8091);
const BACKEND_PORT = Number(process.env.BACKEND_PORT ?? 8080);

const me = { id: 1, username: "prober", nickname: "Prober", avatarId: 0, intro: "" };
const page = { page_start: 1, page_size: 50, has_prev: false, has_more: false };

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
  });
  res.end(text);
}

// cheese-auth. The app boots by refreshing, and the answer to this one call is the difference
// between the check exercising the router and the check watching a login screen.
createServer((req, res) => {
  const { pathname } = new URL(req.url ?? "/", "http://upstream");
  if (pathname === "/users/auth/refresh-token") {
    return json(res, 200, { data: { user: me, accessToken: "probe-token" } });
  }
  if (pathname === "/users/me") return json(res, 200, { data: { user: me } });
  return json(res, 404, { message: `no fake for ${req.method} ${pathname}` });
}).listen(AUTH_PORT, "0.0.0.0", () => console.log(`fake cheese-auth on ${AUTH_PORT}`));

// The backend. Empty collections rather than absent ones: the check is about which screen the app
// reaches, and an empty list is a screen while an error is a different one.
createServer((req, res) => {
  const { pathname } = new URL(req.url ?? "/", "http://upstream");

  // Any conversation, so a deep link to one is a real screen rather than a 404 the app reports as
  // an error. Which conversation is not the point here — that it renders from a URL is.
  const thread = /^\/chat\/(\d+)$/.exec(pathname);
  if (thread) {
    const id = Number(thread[1]);
    return json(res, 200, {
      thread: { id, title: "Probe conversation", createdAt: "2026-09-01T00:00:00Z" },
      members: [
        { id: 1, threadId: id, userId: 1, role: "OWNER", joinedAt: "2026-09-01T00:00:00Z", nickname: "Prober" },
      ],
    });
  }
  if (/^\/chat\/\d+\/messages$/.test(pathname)) return json(res, 200, { messages: [], page });

  switch (pathname) {
    case "/team":
      return json(res, 200, { teams: [{ id: 1, name: "Probe Team" }], page });
    case "/chat":
      return json(res, 200, { chats: [], page });
    case "/agent":
      return json(res, 200, { agents: [], page });
    case "/machine":
      return json(res, 200, { machines: [], page });
    case "/document":
      return json(res, 200, { documents: [], page });
    case "/lines":
      // The registry the worker races over. MT_LINES names the extra origins; "" is always first,
      // meaning the page's own. A deployment publishes these from application.multipath.lines —
      // see ops/microteams/multipath-lines.md — and every field is spelled out on purpose: a null
      // anywhere here makes the real client reject the whole registry and fall back to one line.
      return json(res, 200, {
        lines: [
          { id: "origin", url: "", transport: "same-origin", weight: 100, foreignOrigin: false },
          ...(process.env.MT_LINES ?? "")
            .split(",")
            .filter(Boolean)
            .map((url, i) => ({
              id: `line-${i + 1}`,
              url,
              transport: "direct",
              weight: 90,
              foreignOrigin: false,
            })),
        ],
      });
    default:
      return json(res, 404, { message: `no fake for ${req.method} ${pathname}` });
  }
}).listen(BACKEND_PORT, "0.0.0.0", () => console.log(`fake backend on ${BACKEND_PORT}`));
