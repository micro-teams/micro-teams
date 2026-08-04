// What this file is for: proving that routing every request through MultiPath changed nothing.
//
// "Zero behaviour change" is easy to claim and easy to get wrong invisibly — a lost query string, a
// dropped body, a header that no longer goes out. None of those break a build or a type check, and
// with one same-origin line configured the app looks fine right up until it is asked something
// specific. So the claim is written down as assertions on the exact URL and init that reach the
// network, and the one permitted difference (a key on writes) is named rather than tolerated.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { chatApi, mtCall, setNtAccessToken, setNtReauthorize } from "./mtApi";

/** The fetch the app ends up calling, so the test can read what would have gone out. */
let calls: Array<{ url: string; init: RequestInit }>;

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  calls = [];
  setNtAccessToken("token-abc");
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
      calls.push({ url: String(input), init });
      return Promise.resolve(reply({ chats: [], page: {} }));
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  setNtAccessToken(null);
});

describe("requests still go where they went before MultiPath", () => {
  it("sends a read to the same relative URL, query string and all", async () => {
    await mtCall(chatApi().listChats({ pageStart: 3, pageSize: 20 }));

    expect(calls).toHaveLength(1);
    // Relative, not absolute: the same-origin line resolves to the path unchanged, which is what
    // makes this step a no-op. An absolute URL here would mean the sentinel escaped the adapter.
    expect(calls[0].url).toBe("/mt/chat?page_start=3&page_size=20");
  });

  // Not asserted here, deliberately: the first attempt carries no Authorization at all. That is
  // true before this change and after it, and it is a real defect — the contract declares no
  // security scheme, so the generated client never reads the configured token and every call is
  // answered 401, refreshed and retried. Fixing it changes what goes over the wire, so it belongs
  // in its own change rather than inside one whose whole claim is that nothing moved.

  it("carries a write's body and content type unchanged", async () => {
    await mtCall(
      chatApi().postMessage({ id: 7, postMessageRequest: { content: "hi" } }),
    );

    const { url, init } = calls[0];
    expect(url).toBe("/mt/chat/7/messages");
    expect(init.method).toBe("POST");
    expect(headerOf(init, "content-type")).toBe("application/json");
    expect(await bodyOf(init)).toBe(JSON.stringify({ content: "hi" }));
  });

  // The one difference this integration is allowed to make. It is added by the transport rather
  // than by the contract, which is why no endpoint had to be re-declared for it.
  it("adds an idempotency key to writes, and only to writes", async () => {
    await mtCall(
      chatApi().postMessage({ id: 7, postMessageRequest: { content: "hi" } }),
    );
    expect(headerOf(calls[0].init, "idempotency-key")).toMatch(/\S/);

    calls = [];
    await mtCall(chatApi().listChats({}));
    expect(headerOf(calls[0].init, "idempotency-key")).toBeNull();
  });
});

describe("the silent re-auth retry", () => {
  it("goes back out through the line manager, not a bare fetch", async () => {
    // The failure this guards against: the retry used to call fetch(url) directly, and `url` is now
    // the sentinel-origin URL the generated client built. A bare fetch would try to resolve
    // multipath.invalid and fail DNS — on the token-expiry path only, so it would surface long after
    // deploy as "requests start failing after a while".
    let served = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
        calls.push({ url: String(input), init });
        served += 1;
        return Promise.resolve(
          served === 1 ? reply({ message: "expired" }, 401) : reply([]),
        );
      }),
    );
    setNtReauthorize(async () => "token-fresh");

    await mtCall(chatApi().listChats({}));

    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.url.startsWith("/mt/")).toBe(true);
      expect(call.url).not.toContain("multipath.invalid");
    }
    expect(headerOf(calls[1].init, "authorization")).toBe("Bearer token-fresh");
  });
});

function headerOf(init: RequestInit, name: string): string | null {
  return new Headers(init.headers).get(name);
}

async function bodyOf(init: RequestInit): Promise<string> {
  const body = init.body;
  if (typeof body === "string") return body;
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
  return String(body);
}
