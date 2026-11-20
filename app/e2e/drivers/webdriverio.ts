/*
 * The Android Driver: the installed app through Appium's UiAutomator2 driver, via WebdriverIO.
 * React Native exposes a testID as the view's resource-id, so that is what elements are found by.
 *
 * new WebdriverioDriver({ appPackage, appActivity }) — expects an Appium server on 127.0.0.1:4723
 *   and an emulator with the app installed. tap() puts the keyboard away first, as a person does
 *   before reaching for a button it covers. There is no go(): an installed app has no address bar,
 *   and a link the CLI prints opens in a browser. The live screen's keyboard is the phone's own,
 *   raised by the screen's keyboard key; typing into the terminal raises it, types, and puts it
 *   away; a scroll is a finger dragged down the terminal.
 *
 * Example: await journey(new WebdriverioDriver({ appPackage: "app.microteams.microteams", appActivity: ".MainActivity" }), params);
 */
import { remote } from "webdriverio";
import type { Driver } from "../journey";

type Browser = Awaited<ReturnType<typeof remote>>;

export class WebdriverioDriver implements Driver {
  private b?: Browser;

  constructor(private readonly app: { appPackage: string; appActivity: string }) {}

  private get browser(): Browser {
    if (!this.b) throw new Error("open() first");
    return this.b;
  }

  private byId(id: string) {
    return this.browser.$(`android=new UiSelector().resourceId("${id}")`);
  }

  /**
   * The element with this id, scrolled into view first when it is not on screen: UiAutomator sees
   * only what is drawn, a long form (registering) runs past the bottom of a phone, and a page come
   * back to keeps the scroll it was left with, so what is wanted may be above.
   */
  private async shown(id: string, timeoutMs = 15_000) {
    const el = await this.byId(id);
    // Swipe the page a step at a time (a finger, not an API: what a person does) until it appears:
    // down the page first, then back up it.
    for (let i = 0; i < 12 && !(await el.isDisplayed().catch(() => false)); i++) {
      const page = await this.browser.$("android=new UiSelector().scrollable(true)");
      if (!(await page.isExisting())) break;
      if (await this.browser.isKeyboardShown()) await this.browser.hideKeyboard();
      const { x, y } = await page.getLocation();
      const { width, height } = await page.getSize();
      const cx = Math.round(x + width / 2);
      await this.browser
        .action("pointer", { parameters: { pointerType: "touch" } })
        .move({ x: cx, y: Math.round(y + height * (i < 6 ? 0.75 : 0.3)) })
        .down()
        .pause(100)
        .move({ x: cx, y: Math.round(y + height * (i < 6 ? 0.3 : 0.75)), duration: 400 })
        .pause(100)
        .up()
        .perform();
    }
    await el.waitForDisplayed({ timeout: timeoutMs });
    return el;
  }

  async open() {
    this.b = await remote({
      hostname: "127.0.0.1",
      port: 4723,
      logLevel: "warn",
      capabilities: {
        platformName: "Android",
        "appium:automationName": "UiAutomator2",
        "appium:appPackage": this.app.appPackage,
        "appium:appActivity": this.app.appActivity,
        "appium:noReset": false,
        "appium:newCommandTimeout": 240,
      },
    });
    await this.waitFor("go-register", 60_000);
  }

  async fill(id: string, text: string) {
    const el = await this.shown(id);
    await el.clearValue();
    await el.setValue(text);
  }

  async tap(id: string) {
    if (await this.browser.isKeyboardShown()) await this.browser.hideKeyboard();
    const el = await this.shown(id);
    await el.click();
  }

  async back() {
    if (await this.browser.isKeyboardShown()) await this.browser.hideKeyboard();
    await this.browser.back();
  }

  async waitFor(id: string, timeoutMs = 15_000) {
    // Where it should appear first; then scrolled for, because a page come back to keeps its scroll
    // and the platform does not keep views that are off screen.
    const appeared = await (await this.byId(id)).waitForDisplayed({ timeout: Math.min(timeoutMs, 5000) }).then(
      () => true,
      () => false,
    );
    if (!appeared) await this.shown(id, timeoutMs);
  }

  private byText(text: string) {
    return this.browser.$(`android=new UiSelector().text("${text}")`);
  }

  async waitForText(text: string, timeoutMs = 15_000) {
    await (await this.byText(text)).waitForDisplayed({ timeout: timeoutMs });
  }

  async shows(text: string) {
    return (await this.byText(text)).isDisplayed().catch(() => false);
  }

  async text(id: string) {
    return (await (await this.byId(id)).getText()).trim();
  }

  async waitGone(id: string, timeoutMs = 15_000) {
    await (await this.byId(id)).waitForDisplayed({ timeout: timeoutMs, reverse: true });
  }

  async label(id: string) {
    return (await (await this.byId(id)).getAttribute("content-desc")) ?? "";
  }

  async keyboard(open: boolean) {
    if (open === (await this.browser.isKeyboardShown())) return;
    if (open) await (await this.shown("screen-keyboard")).click();
    else await this.browser.hideKeyboard();
    await this.browser.waitUntil(async () => (await this.browser.isKeyboardShown()) === open, { timeout: 10_000 });
  }

  async typeInTerminal(text: string) {
    await this.keyboard(true);
    await this.browser.keys([...text].map((ch) => (ch === "\x7f" ? "\uE003" : ch)));
    await this.keyboard(false);
  }

  async scrollTerminal() {
    const el = await this.byId("terminal");
    const { x, y } = await el.getLocation();
    const { width, height } = await el.getSize();
    const cx = Math.round(x + width / 2);
    await this.browser
      .action("pointer", { parameters: { pointerType: "touch" } })
      .move({ x: cx, y: Math.round(y + height * 0.2) })
      .down()
      .pause(100)
      .move({ x: cx, y: Math.round(y + height * 0.8), duration: 600 })
      .up()
      .perform();
  }

  async dump() {
    await this.browser.saveScreenshot("failure.png").catch(() => {});
    return (await this.browser.getPageSource().catch((e: unknown) => String(e))).slice(0, 20000);
  }

  async close() {
    await this.b?.deleteSession();
  }
}
