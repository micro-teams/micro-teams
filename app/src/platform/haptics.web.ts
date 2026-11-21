/*
 * A short tap felt in the hand, for a key that was pressed: the web's vibrate, where the browser
 * has one (Chrome and Firefox on Android do; Safari on iOS does not, and there it is nothing).
 *
 * tick(): void — a 10 ms vibration.
 *
 * Example: onPressOut={() => tick()}
 */
export function tick(): void {
  if (typeof navigator.vibrate === "function") navigator.vibrate(10);
}
