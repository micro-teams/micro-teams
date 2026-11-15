/*
 * The web Driver: Chromium through Playwright, at a phone's size, elements found by the
 * data-testid react-native-web renders for a testID.
 *
 * new PlaywrightDriver(url) — opens url on open(). Console errors, failed requests and HTTP errors
 *   are recorded and returned by dump().
 *
 * Example: await journey(new PlaywrightDriver("http://localhost/app/"), params);
 */
import { Browser, chromium, Page } from "playwright";
import type { Driver } from "../journey";

export class PlaywrightDriver implements Driver {
  private browser?: Browser;
  private page?: Page;
  private readonly log: string[] = [];

  constructor(private readonly url: string) {}

  private get p(): Page {
    if (!this.page) throw new Error("open() first");
    return this.page;
  }

  async open() {
    this.browser = await chromium.launch();
    this.page = await this.browser.newPage({ viewport: { width: 390, height: 844 } });
    this.p.on("console", (m) => {
      if (m.type() === "error") this.log.push(`console: ${m.text()}`);
    });
    this.p.on("response", (r) => {
      if (r.status() >= 400) this.log.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`);
    });
    this.p.on("requestfailed", (r) => this.log.push(`failed: ${r.method()} ${r.url()} ${r.failure()?.errorText}`));
    await this.p.goto(this.url);
  }

  async fill(id: string, text: string) {
    await this.p.getByTestId(id).fill(text);
  }

  async tap(id: string) {
    await this.p.getByTestId(id).click();
  }

  async back() {
    await this.p.goBack({ waitUntil: "commit" });
  }

  async waitFor(id: string, timeoutMs = 15_000) {
    await this.p.getByTestId(id).first().waitFor({ state: "visible", timeout: timeoutMs });
  }

  async waitForText(text: string, timeoutMs = 15_000) {
    await this.p.getByText(text, { exact: true }).first().waitFor({ state: "visible", timeout: timeoutMs });
  }

  async waitGone(id: string, timeoutMs = 15_000) {
    await this.p.getByTestId(id).first().waitFor({ state: "hidden", timeout: timeoutMs });
  }

  async dump() {
    await this.p.screenshot({ path: "failure.png" }).catch(() => {});
    const text = await this.p.evaluate(() => document.body.innerText).catch((e: unknown) => String(e));
    return `--- on screen ---\n${text}\n--- log ---\n${this.log.join("\n")}`;
  }

  async close() {
    await this.browser?.close();
  }
}
