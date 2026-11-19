/*
 * Everything that differs between the web and a phone, in one file: the rest of the app asks
 * these questions instead of looking at Platform.OS (a lint rule keeps it that way).
 *
 * isWeb — true in a browser.
 * appVersion — this build's version: VERSION-<commit> in CI, app.json's otherwise. clientPlatform — "web", "android" or "ios".
 * pageOrigin() — the origin the page was served from, or null on a phone.
 * onBack(handler) → unsubscribe — the platform's back: Android's back button, the browser's back
 *   button. handler returns whether it consumed the press (false lets Android leave the app).
 * guardHistory() — on the web, put one history entry up for the next browser-back to consume; a
 *   no-op on a phone.
 * takeLink() → { path, query } | null — on the web, the address the page was opened at, relative to
 *   where the app is served (null at the app's own root), and the address bar is put back to that
 *   root: the link has been read, and the app's state is the stack from now on. Null on a phone.
 * download(url) — fetch a file for the person to keep: on the web a link with the download attribute,
 *   clicked in this page — no window is opened, which a browser may block, or leave behind empty
 *   when the file arrives as an attachment, or open as a page in an installed web app; on a phone the
 *   system opens it.
 *
 * Example:
 *   useEffect(() => onBack(() => pop()), [pop]);
 *   if (stack.length > 1) guardHistory();
 */
import { BackHandler, Linking, Platform } from "react-native";
import app from "../../app.json";

export const isWeb = Platform.OS === "web";
// VERSION-<commit> from CI (EXPO_PUBLIC_MT_VERSION): the release and the exact build in one string,
// which is what a bug report needs; app.json's version when built by hand.
export const appVersion: string = process.env.EXPO_PUBLIC_MT_VERSION || app.expo.version;
export const clientPlatform: string = Platform.OS;

export function pageOrigin(): string | null {
  return isWeb ? window.location.origin : null;
}

export function onBack(handler: () => boolean): () => void {
  if (isWeb) {
    const listener = () => {
      handler();
    };
    window.addEventListener("popstate", listener);
    return () => window.removeEventListener("popstate", listener);
  }
  const sub = BackHandler.addEventListener("hardwareBackPress", handler);
  return () => sub.remove();
}

export function takeLink(): { path: string; query: Record<string, string> } | null {
  if (!isWeb) return null;
  const base = `${process.env.EXPO_BASE_URL ?? ""}/`;
  const { pathname, search } = window.location;
  const path = pathname.startsWith(base) ? pathname.slice(base.length) : "";
  if (!path || path === "index.html") return null;
  window.history.replaceState(null, "", base);
  return { path, query: Object.fromEntries(new URLSearchParams(search)) };
}

export function guardHistory() {
  if (isWeb) window.history.pushState({ mt: "guard" }, "");
}

export function download(url: string) {
  if (!isWeb) return void Linking.openURL(url);
  const a = document.createElement("a");
  a.href = url;
  a.download = url.slice(url.lastIndexOf("/") + 1);
  document.body.appendChild(a);
  a.click();
  a.remove();
}
