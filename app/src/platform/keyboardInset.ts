/*
 * What the terminal needs to know about the on-screen keyboard, on a phone.
 *
 * useKeyboardInset() → px — how much of the bottom of the window the keyboard will cover. It
 *   changes once when the keyboard starts to open (to its final height) and once when it starts to
 *   close (to 0), never frame by frame: a terminal resized on every frame of the keyboard's slide
 *   would be redrawn at every intermediate size. The app draws edge to edge, so the window itself
 *   never shrinks for the keyboard; this is how the live screen makes room.
 * hasTouchKeyboard → whether the person types on a screen keyboard, which has no Esc, Ctrl, Tab or
 *   arrows (true here; on the web, true for a coarse pointer).
 * keyboardInsetKnown → whether useKeyboardInset tells when the keyboard is up (here it does; on
 *   the web the page resizes instead and it is always 0).
 *
 * Example: const inset = useKeyboardInset(); <View style={{ marginBottom: Math.max(insets.bottom, inset) }} />
 */
import { useEffect, useState } from "react";
import { KeyboardEvents } from "react-native-keyboard-controller";

export const hasTouchKeyboard = true;

export const keyboardInsetKnown = true;

export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const show = KeyboardEvents.addListener("keyboardWillShow", (e) => setInset(e.height));
    const hide = KeyboardEvents.addListener("keyboardWillHide", () => setInset(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return inset;
}
