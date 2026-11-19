/*
 * Runs the journey: `tsx run.ts web <url>` or `tsx run.ts android <server as the emulator sees it>`,
 * with SINK (the mail sink's HTTP side), API (the stack, as this machine reaches it; default
 * http://localhost), RUN (a unique suffix), and, for the journey with a machine, ENROLL (the code
 * machine.sh up printed), LEG (the program on the machine, as machine.sh takes it; default
 * npm:2.1.220) and DRIVER (the agent's driver; empty for the server's default) in the
 * environment. Prints each step's time and exits non-zero, with what was on screen, when the
 * journey fails.
 *
 * Example: SINK=http://localhost:52027 RUN=w1 npx tsx run.ts web http://localhost/app/
 */
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PlaywrightDriver } from "./drivers/playwright";
import { WebdriverioDriver } from "./drivers/webdriverio";
import { journey } from "./journey";

const [client, where] = process.argv.slice(2);
if (client !== "web" && client !== "android") throw new Error("usage: run.ts web <url> | android <server>");
const mail = process.env.SINK ?? "http://localhost:52027";
const api = process.env.API ?? "http://localhost";
const run = process.env.RUN ?? String(Date.now());
const leg = process.env.LEG ?? "npm:2.1.220";
const machine = process.env.ENROLL
  ? {
      code: process.env.ENROLL,
      driver: process.env.DRIVER ?? "",
      heard: async (text: string) => void (await promisify(execFile)("bash", [fileURLToPath(new URL("machine.sh", import.meta.url)), "saw", leg, text])),
    }
  : null;

const driver =
  client === "web"
    ? new PlaywrightDriver(where)
    : new WebdriverioDriver({ appPackage: "app.microteams.microteams", appActivity: ".MainActivity" });

const started = Date.now();
journey(driver, { server: client === "web" ? null : where, api, mail, run, machine }).then(
  () => console.log(`PASS ${client} in ${Date.now() - started} ms`),
  async (e: unknown) => {
    console.error(`FAIL ${client} after ${Date.now() - started} ms:`, e);
    console.error(await driver.dump().catch((x: unknown) => `(no dump: ${String(x)})`));
    await driver.close().catch(() => {});
    process.exit(1);
  },
);
