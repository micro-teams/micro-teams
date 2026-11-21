/*
 * A short tap felt in the hand, for a key that was pressed.
 *
 * tick(): void — a light impact through the device's haptics. On native it never fails the key it
 *   answers: a device without haptics reports so in the log.
 *
 * Example: onPressOut={() => tick()}
 */
import * as Haptics from "expo-haptics";

export function tick(): void {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch((e: Error) => console.warn(`haptics: ${e.message}`));
}
