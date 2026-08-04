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
  // The exact document our own backend serves for a line whose optional fields are unset: Jackson
  // spells "no value" as null. The library used to reject the whole registry over it and the client
  // silently kept one line, which looked identical to a healthy single-line deployment — it was
  // found in production only when a real second line failed to appear.
  it("adopts a registry whose optional fields are null", async () => {
    answers({
      lines: [
        {
          id: "origin",
          url: "",
          transport: null,
          weight: null,
          foreignOrigin: null,
        },
        {
          id: "direct",
          url: "https://direct.mt.example.app",
          transport: "direct",
          weight: 90,
          foreignOrigin: null,
        },
      ],
    });

    await startLineManagement();

    expect(lineManager.lines.map((line) => line.id)).toEqual([
      "origin",
      "direct",
    ]);
  });

  // The fallback stays, but it stops being silent: a registry that arrived and could not be read is
  // a misconfiguration, not the offline case.
  it("says so when it throws a registry away", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    answers({ lines: [{ id: "a", url: "https://x.example/with/path" }] });

    await startLineManagement();

    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

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
