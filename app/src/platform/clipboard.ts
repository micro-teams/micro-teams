/*
 * Text to the system clipboard, without touching the focus.
 *
 * writeClipboard(text): Promise<void> — resolves once the clipboard holds text, rejects with the
 *   reason it could not.
 *
 * Example: writeClipboard("hello").then(() => toast("copied"), (e) => toast(e.message))
 */
import * as Clipboard from "expo-clipboard";

export async function writeClipboard(text: string): Promise<void> {
  if (!(await Clipboard.setStringAsync(text))) throw new Error("the clipboard refused the text");
}
