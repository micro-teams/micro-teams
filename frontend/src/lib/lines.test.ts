// The registry swap at startup, and what it must survive.
//
// This is the transport layer's own bootstrap, so its failure modes matter more than its happy
// path: the app has to start when the endpoint is missing, when it answers rubbish, and when the
// network is simply not there. Each of those is a thing that happens on a real machine, and none of
// them is a reason for a page not to load.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { lineManager, startLineManagement } from "./lines";

const originOnly = [
  { id: "origin", url: "", transport: "same-origin", weight: 100 },
];

beforeEach(() => {
  lineManager.setRegistry({ lines: originOnly });
});

afterEach(() => {
  lineManager.stop();
  vi.unstubAllGlobals();
  lineManager.setRegistry({ lines: originOnly });
});

function answers(body: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(typeof body === "string" ? body : JSON.stringify(body), {
          status: ok ? 200 : 503,
          headers: { "content-type": "application/json" },
        }),
      ),
    ),
  );
}

describe("startup registry", () => {
  it("adopts the lines the deployment reports", async () => {
    answers({
      lines: [
        { id: "origin", url: "", transport: "same-origin", weight: 100 },
        {
          id: "cf",
          url: "https://cf.example.app",
          transport: "cloudflare",
          weight: 90,
        },
      ],
    });

    await startLineManagement();

    expect(lineManager.lines.map((line) => line.id)).toEqual(["origin", "cf"]);
  });

  it("keeps the origin line when the endpoint is not there", async () => {
    answers({ error: "not found" }, false);

    await startLineManagement();

    expect(lineManager.lines.map((line) => line.id)).toEqual(["origin"]);
  });

  // A registry with a duplicate id or a url carrying a path is rejected by the parser. The app must
  // still start: a routing table it cannot read is no worse than the one it already has.
  it("keeps the origin line when the registry is malformed", async () => {
    answers({ lines: [{ id: "a", url: "https://x.example/with/path" }] });

    await startLineManagement();

    expect(lineManager.lines.map((line) => line.id)).toEqual(["origin"]);
  });

  it("starts anyway when the network is down", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("failed to fetch"))),
    );

    await expect(startLineManagement()).resolves.toBeUndefined();
    expect(lineManager.lines.map((line) => line.id)).toEqual(["origin"]);
  });
});
