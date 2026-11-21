/*
 * Text to the system clipboard, without touching the focus: the browser's asynchronous clipboard
 * only. A copy through a hidden text field would take the focus from the terminal and close a
 * phone's keyboard, so where the asynchronous clipboard is missing (a page not served over https
 * or from localhost) the copy fails and says why.
 *
 * writeClipboard(text): Promise<void> — resolves once the clipboard holds text, rejects with the
 *   reason it could not.
 *
 * Example: writeClipboard("hello").then(() => toast("copied"), (e) => toast(e.message))
 */
export async function writeClipboard(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText) throw new Error("this browser gives the clipboard only to https pages");
  await navigator.clipboard.writeText(text);
}
