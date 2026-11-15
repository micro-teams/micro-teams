/*
 * The web Driver: Chromium through Playwright, at a phone's size, elements found by the
 * data-testid react-native-web renders for a testID. Only what is visible counts: every frame of
 * every stack stays mounted, hidden, so the same id or text is usually also somewhere off screen.
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

  private id(id: string) {
    return this.p.getByTestId(id).filter({ visible: true }).first();
  }

  async fill(id: string, text: string) {
    await this.id(id).fill(text);
  }

  async tap(id: string) {
    await this.id(id).click();
  }

  async back() {
    await this.p.goBack({ waitUntil: "commit" });
  }

  async waitFor(id: string, timeoutMs = 15_000) {
    await this.id(id).waitFor({ state: "visible", timeout: timeoutMs });
  }

  async waitForText(text: string, timeoutMs = 15_000) {
    await this.p.getByText(text, { exact: true }).filter({ visible: true }).first().waitFor({ state: "visible", timeout: timeoutMs });
  }

  async waitGone(id: string, timeoutMs = 15_000) {
    await this.id(id).waitFor({ state: "hidden", timeout: timeoutMs });
  }

  /**
   * The service worker, checked from the page: it controls the page after a reload, it has sent
   * requests over the substrate, and the app opens with the network gone, showing the element with
   * this id. Returns its stats.
   */
  async checkWorker(shownId: string) {
    const stats = () =>
      this.p.evaluate(async () => {
        const reg = await navigator.serviceWorker.ready;
        return new Promise<{ build: string; lines: string[]; routed: number; direct: number }>((resolve) => {
          const channel = new MessageChannel();
          channel.port1.onmessage = (e) => resolve(e.data);
          reg.active!.postMessage({ type: "stats" }, [channel.port2]);
        });
      });
    await stats();
    await this.p.reload();
    await this.id(shownId).waitFor({ state: "visible", timeout: 15_000 });
    const controlled = await this.p.evaluate(() => !!navigator.serviceWorker.controller);
    if (!controlled) throw new Error("the service worker does not control the page after a reload");
    const online = await stats();
    if (!online.routed) throw new Error(`nothing went over the substrate: ${JSON.stringify(online)}`);
    await this.p.context().setOffline(true);
    try {
      await this.p.reload();
      await this.id(shownId).waitFor({ state: "visible", timeout: 15_000 });
    } finally {
      await this.p.context().setOffline(false);
    }
    return online;
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
