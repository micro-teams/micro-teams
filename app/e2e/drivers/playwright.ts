/*
 * The web Driver: Chromium or Firefox through Playwright, at a phone's size (a touch screen, in
 * Chromium a mobile one) or a desktop's, elements found by the data-testid react-native-web renders
 * for a testID. Only what is visible counts: every frame of every stack stays mounted, hidden, so
 * the same id or text is usually also somewhere off screen.
 *
 * new PlaywrightDriver(url, { browser, viewport }) — opens url on open(), where the app is served;
 *   go(path) opens an address under it, as a link pasted into the address bar does. Console errors,
 *   failed requests and HTTP errors are recorded and returned by dump(); the app's own account of
 *   how long the live screen took to open is printed. The keyboard of the live
 *   screen is the page made shorter by 40%, as a phone's keyboard makes a page that asks for
 *   resizes-content; a scroll is a finger dragged down on a touch screen and a wheel turn on a desktop.
 *
 * Example: await journey(new PlaywrightDriver("http://localhost/app/", { browser: "firefox", viewport: "desktop" }), params);
 */
import { Browser, chromium, firefox, Page } from "playwright";
import type { Driver } from "../journey";

export class PlaywrightDriver implements Driver {
  private browser?: Browser;
  private page?: Page;
  private readonly log: string[] = [];

  private size = { width: 390, height: 844 };

  constructor(
    private readonly url: string,
    private readonly opts: { browser: "chromium" | "firefox"; viewport: "phone" | "desktop" },
  ) {
    if (opts.viewport === "desktop") this.size = { width: 1280, height: 800 };
  }

  private get p(): Page {
    if (!this.page) throw new Error("open() first");
    return this.page;
  }

  async open() {
    const phone = this.opts.viewport === "phone";
    this.browser = await (this.opts.browser === "firefox" ? firefox : chromium).launch();
    this.page = await this.browser.newPage({
      viewport: this.size,
      hasTouch: phone,
      isMobile: phone && this.opts.browser === "chromium",
    });
    this.p.on("console", (m) => {
      if (m.type() === "error") this.log.push(`console: ${m.text()}`);
      // How long the live screen took to open, step by step, as the app measures it.
      if (m.text().startsWith("screen: opened")) console.log(`  ${m.text()}`);
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

  async shows(text: string) {
    return (await this.p.getByText(text, { exact: true }).filter({ visible: true }).count()) > 0;
  }

  async text(id: string) {
    return (await this.id(id).innerText({ timeout: 2000 })).trim();
  }

  async go(path: string) {
    await this.p.goto(new URL(path, this.url).href);
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
        return new Promise<{ build: string; routed: number; direct: number }>((resolve) => {
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

  async label(id: string) {
    return (await this.id(id).getAttribute("aria-label", { timeout: 2000 })) ?? "";
  }

  async keyboard(open: boolean) {
    const { width, height } = this.size;
    await this.p.setViewportSize({ width, height: open ? Math.round(height * 0.6) : height });
  }

  async typeInTerminal(text: string) {
    // xterm's input is a textarea it keeps out of sight; it has the focus once the terminal does.
    await this.p.evaluate(
      `[...document.querySelectorAll(".xterm")].find((e) => e.offsetParent !== null).querySelector(".xterm-helper-textarea").focus()`,
    );
    for (const ch of text) {
      if (ch === "\x7f") await this.p.keyboard.press("Backspace");
      else await this.p.keyboard.type(ch);
    }
  }

  async scrollTerminal() {
    const box = await this.id("terminal").boundingBox();
    if (!box) throw new Error("no terminal to scroll");
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 3;
    if (this.opts.viewport === "desktop") {
      await this.p.mouse.move(x, y);
      for (let i = 0; i < 5; i++) await this.p.mouse.wheel(0, -120);
      return;
    }
    // A finger dragged down the terminal, as touch events: Playwright's touchscreen only taps.
    await this.p.evaluate(`(() => {
      const x = ${x}, y = ${y};
      const target = document.elementFromPoint(x, y);
      const touch = (cy) => new Touch({ identifier: 1, target, clientX: x, clientY: cy });
      const fire = (type, cy) =>
        target.dispatchEvent(new TouchEvent(type, { touches: type === "touchend" ? [] : [touch(cy)], changedTouches: [touch(cy)], bubbles: true, cancelable: true }));
      fire("touchstart", y);
      for (let i = 1; i <= 20; i++) fire("touchmove", y + i * 15);
      fire("touchend", y + 300);
    })()`);
  }

  // The functions below run in the page. They are strings, not functions: the runner that compiles
  // this file adds helpers to functions that do not exist in the page.

  async watchOverflow(on: boolean) {
    if (on) {
      await this.p.evaluate(`(() => {
        window.__overflow = { below: 0, clippedMs: 0, last: 0, run: true };
        // Sampled after each paint (a task queued from the frame's callback runs once it is drawn):
        // a frame's callbacks run before its layout and resize observers, so geometry read in the
        // callback itself can be a state that is never painted.
        const sample = (now) => {
          const o = window.__overflow;
          const xterm = [...document.querySelectorAll(".xterm")].find((e) => e.offsetParent !== null);
          const screen = xterm && xterm.querySelector(".xterm-screen");
          if (screen) {
            const s = screen.getBoundingClientRect();
            const h = xterm.parentElement.getBoundingClientRect();
            o.below = Math.max(o.below, s.bottom - h.bottom);
            if (s.top < h.top - 0.5 && o.last) o.clippedMs += now - o.last;
          }
          o.last = now;
        };
        const tick = (now) => {
          if (!window.__overflow.run) return;
          setTimeout(() => sample(performance.now()), 0);
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      })()`);
      return { below: 0, clippedMs: 0 };
    }
    return (await this.p.evaluate(
      `(() => { const o = window.__overflow; o.run = false; return { below: Math.max(0, Math.round(o.below)), clippedMs: Math.round(o.clippedMs) }; })()`,
    )) as { below: number; clippedMs: number };
  }

  async terminalOffsets() {
    return (await this.p.evaluate(`(() => {
      const xterm = [...document.querySelectorAll(".xterm")].find((e) => e.offsetParent !== null);
      const host = xterm.parentElement.getBoundingClientRect();
      const screen = xterm.querySelector(".xterm-screen").getBoundingClientRect();
      const rows = xterm.querySelectorAll(".xterm-rows > div").length;
      return {
        left: Math.round(screen.left - host.left),
        right: Math.round(host.right - screen.right),
        top: Math.round(screen.top - host.top),
        bottom: Math.round(host.bottom - screen.bottom),
        cell: Math.ceil(screen.height / Math.max(1, rows)),
      };
    })()`)) as { left: number; right: number; top: number; bottom: number; cell: number };
  }

  async terminalScrolled() {
    return (await this.p.evaluate(`(() => {
      const xterm = [...document.querySelectorAll(".xterm")].find((e) => e.offsetParent !== null);
      const viewport = xterm.querySelector(".xterm-viewport");
      return viewport.scrollTop !== 0 ? "its viewport is scrolled " + viewport.scrollTop + " px" : null;
    })()`)) as string | null;
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
