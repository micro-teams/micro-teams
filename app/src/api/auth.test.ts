/*
 * The refresh cookie rotates, so a refresh is never sent twice at once.
 *
 * Run with `npm test`. fetch is a fake that counts the refreshes it is asked for.
 */
import { refresh } from "./auth";

test("refreshes asked for together are one request, and the next is a new one", async () => {
  let calls = 0;
  const answer = { code: 200, data: { user: { id: 1, username: "a", nickname: "a" }, accessToken: "t" } };
  global.fetch = jest.fn(async () => {
    calls += 1;
    return new Response(JSON.stringify(answer), { status: 200 });
  }) as unknown as typeof fetch;
  const [a, b] = await Promise.all([refresh("https://x"), refresh("https://x")]);
  expect(calls).toBe(1);
  expect(a).toBe(b);
  await refresh("https://x");
  expect(calls).toBe(2);
});
