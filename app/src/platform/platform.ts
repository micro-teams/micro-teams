/*
 * Everything that differs between the web and a phone, in one file: the rest of the app asks
 * these questions instead of looking at Platform.OS (a lint rule keeps it that way).
 *
 * isWeb — true in a browser.
 * pageOrigin() — the origin the page was served from, or null on a phone.
 * onBack(handler) → unsubscribe — the platform's back: Android's back button, the browser's back
 *   button. handler returns whether it consumed the press (false lets Android leave the app).
 * guardHistory() — on the web, put one history entry up for the next browser-back to consume; a
 *   no-op on a phone.
 *
 * Example:
 *   useEffect(() => onBack(() => pop()), [pop]);
 *   if (stack.length > 1) guardHistory();
 */
import { BackHandler, Platform } from "react-native";

export const isWeb = Platform.OS === "web";

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

export function guardHistory() {
  if (isWeb) window.history.pushState({ mt: "guard" }, "");
}
