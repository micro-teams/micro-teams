/*
 * The Android Driver: the installed app through Appium's UiAutomator2 driver, via WebdriverIO.
 * React Native exposes a testID as the view's resource-id, so that is what elements are found by.
 *
 * new WebdriverioDriver({ appPackage, appActivity }) — expects an Appium server on 127.0.0.1:4723
 *   and an emulator with the app installed. tap() puts the keyboard away first, as a person does
 *   before reaching for a button it covers.
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
   * only what is drawn, and a long form (registering) runs past the bottom of a phone.
   */
  private async shown(id: string, timeoutMs = 15_000) {
    const el = await this.byId(id);
    if (!(await el.isDisplayed().catch(() => false))) {
      const scroll = `android=new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(new UiSelector().resourceId("${id}"))`;
      await (await this.browser.$(scroll)).isExisting().catch(() => false);
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
    await (await this.byId(id)).waitForDisplayed({ timeout: timeoutMs });
  }

  async waitForText(text: string, timeoutMs = 15_000) {
    await (await this.browser.$(`android=new UiSelector().text("${text}")`)).waitForDisplayed({ timeout: timeoutMs });
  }

  async waitGone(id: string, timeoutMs = 15_000) {
    await (await this.byId(id)).waitForDisplayed({ timeout: timeoutMs, reverse: true });
  }

  async dump() {
    await this.browser.saveScreenshot("failure.png").catch(() => {});
    return (await this.browser.getPageSource().catch((e: unknown) => String(e))).slice(0, 20000);
  }

  async close() {
    await this.b?.deleteSession();
  }
}
