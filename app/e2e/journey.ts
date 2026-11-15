/*
 * The journey: one script of what a person does in the app, written once and driven on the web
 * and on Android by whichever Driver it is given.
 *
 * journey(driver, params) — signs up (reading the code from the mail sink), starts a chat, says
 *   something in it, sees it stored, opens a dialog and closes it with back, and signs out.
 *   Returns how long each step took, in ms.
 * Driver — what a journey needs from a client: drivers/playwright.ts for the web build,
 *   drivers/webdriverio.ts for the Android build through Appium.
 * Params — the server to type in (null keeps the client's own), where the mail sink answers, and
 *   a suffix that makes this run's names unique.
 * codeFromMail(mail, email) — the sign-up code cheese-auth mailed to that address.
 *
 * Example: await journey(new PlaywrightDriver("http://localhost/app/"), { server: null, mail, run });
 *
 * Elements are found by testID, which react-native-web renders as data-testid and React Native on
 * Android as the view's resource-id: one name, both clients.
 */

export interface Driver {
  /** Start the client on its first screen. */
  open(): Promise<void>;
  /** Replace the text in the field with this testID. */
  fill(id: string, text: string): Promise<void>;
  tap(id: string): Promise<void>;
  /** The platform's back: the browser's button, or Android's. */
  back(): Promise<void>;
  /** Wait until the element with this testID is on screen. */
  waitFor(id: string, timeoutMs?: number): Promise<void>;
  /** Wait until some element shows exactly this text. */
  waitForText(text: string, timeoutMs?: number): Promise<void>;
  /** Wait until no element with this testID is on screen. */
  waitGone(id: string, timeoutMs?: number): Promise<void>;
  /** What is on screen and what went wrong, for a failed run; also saves failure.png. */
  dump(): Promise<string>;
  close(): Promise<void>;
}

export interface Params {
  server: string | null;
  mail: string;
  run: string;
}

export async function codeFromMail(mail: string, email: string): Promise<string> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const res = await fetch(`${mail}/messages?to=${encodeURIComponent(email)}`);
    for (const m of (await res.json()) as { body: string }[]) {
      const code = /code is:\s*(\d{4,8})/.exec(m.body)?.[1];
      if (code) return code;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no code was mailed to ${email} within 60s`);
}

export async function journey(d: Driver, p: Params): Promise<Record<string, number>> {
  const timings: Record<string, number> = {};
  let last = Date.now();
  const lap = (name: string) => {
    const now = Date.now();
    timings[name] = now - last;
    last = now;
    console.log(`  ${name}: ${timings[name]} ms`);
  };

  const email = `e2e-${p.run}@example.com`;
  const said = `hello ${p.run}`;

  await d.open();
  await d.tap("go-register");
  if (p.server !== null) await d.fill("server", p.server);
  await d.fill("email", email);
  await d.tap("send-code");
  await d.fill("code", await codeFromMail(p.mail, email));
  await d.fill("username", `e2e${p.run}`);
  await d.fill("password", "Passw0rd!x");
  await d.tap("register");
  await d.waitFor("new-chat", 30_000);
  lap("sign up");

  await d.tap("new-chat");
  await d.fill("new-chat-title", `group ${p.run}`);
  await d.tap("new-chat-create");
  await d.waitFor("composer", 30_000);
  lap("new chat");

  await d.fill("composer", said);
  await d.tap("send");
  await d.waitForText(said, 30_000);
  await d.waitGone("pending-message", 30_000);
  lap("send");

  // Back closes the dialog, not the page under it.
  await d.back();
  await d.tap("destination-me");
  await d.tap("sign-out");
  await d.waitFor("dialog");
  await d.back();
  await d.waitGone("dialog");
  await d.waitFor("sign-out");
  await d.tap("sign-out");
  await d.tap("confirm-sign-out");
  await d.waitFor("go-register", 30_000);
  lap("dialog and sign out");

  await d.close();
  return timings;
}
