/*
 * Making a browser's keyboard look like a phone's: on the web, when the on-screen keyboard opens
 * or closes the page is resized at once (public/index.html asks for resizes-content), so what sits
 * on the keyboard jumps. useKeyboardSlide(targets) turns that jump into a glide: as the page
 * resizes while a text field has focus, the views targets() returns are put back where they were
 * and slid to their new place over 220 ms. On a phone it does nothing — the keyboard there is
 * followed frame by frame (react-native-keyboard-controller).
 *
 * Example: useKeyboardSlide(() => (atBottom.current ? [list.current, composer.current] : [composer.current]));
 */
export function useKeyboardSlide(_targets: () => unknown[]): void {}
