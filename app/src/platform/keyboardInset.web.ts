/*
 * The web half of keyboardInset.ts. useKeyboardInset() is 0: a browser resizes the page itself
 * when its keyboard opens (public/index.html asks for resizes-content), in one step. hasTouchKeyboard
 * is true where the primary pointer is a finger.
 */
export const hasTouchKeyboard = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

export function useKeyboardInset(): number {
  return 0;
}
