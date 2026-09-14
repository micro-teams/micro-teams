import { test, expect } from "@playwright/test";

// Drives the compose client the way a person would, against a real deployment run.sh already
// brought up: a real backend+origin+nginx, a real machine with the real connector on it, the real
// Claude Code in front of a mock Anthropic API. Everything the client cannot yet DO through its
// own UI (sign-up, creating a team/chat, enrolling a machine, opening an agent) was set up by
// run.sh through the API before this test starts — this only drives what the client actually has a
// screen for. See run.sh's own header for why, and CLAUDE.md's "which test to write" for the
// principle this is standing in for.
//
// Compose Multiplatform for web paints into one <canvas> with no ordinary DOM; Modifier.testTag on
// an element becomes the id of the accessibility DOM node Compose maintains over that canvas, and
// that node is what actually receives pointer/keyboard input — so plain Playwright locators by id
// work here exactly as they would against real DOM elements.

const baseUrl = process.env.E2E_BASE_URL!;
const username = process.env.E2E_USERNAME!;
const password = process.env.E2E_PASSWORD!;
const seededText = process.env.E2E_SEEDED_TEXT!;

test("sign in, read a seeded message, send one, open the machine's agent", async ({ page }) => {
  await page.goto("/");

  await page.locator("#login-server-url").fill(baseUrl);
  await page.locator("#login-username").fill(username);
  await page.locator("#login-password").fill(password);
  await page.locator("#login-submit").click();

  // The home screen's chats tab, with the thread run.sh seeded a message into.
  await expect(page.locator("[id^='chat-item-']").first()).toBeVisible({ timeout: 30_000 });
  await page.locator("[id^='chat-item-']").first().click();

  await expect(page.locator("[id^='thread-message-']", { hasText: seededText })).toBeVisible({
    timeout: 15_000,
  });

  const sentText = `sent through the client itself — ${Date.now()}`;
  await page.locator("#thread-input").fill(sentText);
  await page.locator("#thread-send").click();
  await expect(page.locator("[id^='thread-message-']", { hasText: sentText })).toBeVisible({
    timeout: 15_000,
  });

  await page.locator("#thread-back").click();

  // The machines tab, and the agent run.sh opened on the real machine.
  await page.locator("#tab-machines").click();
  await expect(page.locator("[id^='agent-item-']").first()).toBeVisible({ timeout: 30_000 });
  await page.locator("[id^='agent-item-']").first().click();

  // Real screen data over the real websocket, from the real connector on the real machine — this
  // is the assertion the whole harness exists for: not that the button navigated, but that
  // something a real host said arrived and was painted.
  await expect
    .poll(async () => (await page.locator("#terminal-output").textContent())?.length ?? 0, {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
});
