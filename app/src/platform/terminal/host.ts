/*
 * The page inside a phone's terminal WebView: mounts page.ts on #t and speaks to TerminalView over
 * postMessage — { type: "write", data: base64 } and { type: "typing", on } in, page.ts's messages
 * out, and { type: "ready" } once it can take them. Bundled into page.generated.ts by
 * tool/terminal-html.mjs; nothing in the app imports it.
 */
import { mountTerminal, type FromTerminal } from "./page";

type Host = { ReactNativeWebView?: { postMessage(text: string): void } };
const post = (m: FromTerminal | { type: "ready" }) => (window as unknown as Host).ReactNativeWebView?.postMessage(JSON.stringify(m));
const term = mountTerminal(document.getElementById("t")!, post, { fontFamily: "monospace" });

const onMessage = (e: Event) => {
  const m = JSON.parse(String((e as MessageEvent).data)) as { type: string; data?: string; on?: boolean };
  if (m.type === "write" && m.data) term.write(Uint8Array.from(atob(m.data), (c) => c.charCodeAt(0)));
  else if (m.type === "typing") term.setTyping(!!m.on);
};
// Android delivers a WebView's messages on document, iOS on window.
window.addEventListener("message", onMessage);
document.addEventListener("message", onMessage);
post({ type: "ready" });
