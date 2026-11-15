/*
 * Runs the journey: `tsx run.ts web <url>` or `tsx run.ts android <server as the emulator sees it>`,
 * with MAIL (the mail sink's HTTP side) and RUN (a unique suffix) in the environment. Prints each
 * step's time and exits non-zero, with what was on screen, when the journey fails.
 *
 * Example: MAIL=http://localhost:52027 RUN=w1 npx tsx run.ts web http://localhost/app/
 */
import { PlaywrightDriver } from "./drivers/playwright";
import { WebdriverioDriver } from "./drivers/webdriverio";
import { journey } from "./journey";

const [client, where] = process.argv.slice(2);
if (client !== "web" && client !== "android") throw new Error("usage: run.ts web <url> | android <server>");
const mail = process.env.MAIL ?? "http://localhost:52027";
const run = process.env.RUN ?? String(Date.now());

const driver =
  client === "web"
    ? new PlaywrightDriver(where)
    : new WebdriverioDriver({ appPackage: "app.microteams", appActivity: ".MainActivity" });

const started = Date.now();
journey(driver, { server: client === "web" ? null : where, mail, run }).then(
  () => console.log(`PASS ${client} in ${Date.now() - started} ms`),
  async (e: unknown) => {
    console.error(`FAIL ${client} after ${Date.now() - started} ms:`, e);
    console.error(await driver.dump().catch((x: unknown) => `(no dump: ${String(x)})`));
    await driver.close().catch(() => {});
    process.exit(1);
  },
);
