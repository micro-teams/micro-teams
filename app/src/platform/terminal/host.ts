/*
 * The page inside a phone's terminal WebView: mounts page.ts on #t and speaks to TerminalView over
 * postMessage. In: ToPage — { type: "write", data: base64 }, { type: "size", cols, rows },
 * { type: "reset" }, { type: "focus", on }. Out: page.ts's FromTerminal, and { type: "ready" }
 * once it can take messages. Bundled into page.generated.ts by tool/terminal-html.mjs; nothing in
 * the app imports it but the type.
 */
import { mountTerminal, type FromTerminal } from "./page";

export type ToPage =
  | { type: "write"; data: string }
  | { type: "size"; cols: number; rows: number }
  | { type: "reset" }
  | { type: "focus"; on: boolean };

type Host = { ReactNativeWebView?: { postMessage(text: string): void } };
const post = (m: FromTerminal | { type: "ready" }) => (window as unknown as Host).ReactNativeWebView?.postMessage(JSON.stringify(m));
// The app's face, embedded in the page by tool/terminal-html.mjs. Loaded before the terminal is
// mounted: xterm measures its cell once, and a cell measured on a fallback face stays wrong.
// A face that does not load is said in the console and the terminal is drawn in the fallback
// face, which is visibly wrong rather than missing.
void Promise.all([document.fonts.load("13px LiberationMono"), document.fonts.load("bold 13px LiberationMono")])
  .catch((e: unknown) => console.error(`terminal: the face did not load: ${String(e)}`))
  .then(() => {
    const term = mountTerminal(document.getElementById("t")!, post, { fontFamily: "LiberationMono, monospace" });
    const onMessage = (e: Event) => {
      const m = JSON.parse(String((e as MessageEvent).data)) as ToPage;
      if (m.type === "write") term.write(Uint8Array.from(atob(m.data), (c) => c.charCodeAt(0)));
      else if (m.type === "size") term.size(m.cols, m.rows);
      else if (m.type === "reset") term.reset();
      else if (m.type === "focus") term.focus(m.on);
    };
    // Android delivers a WebView's messages on document, iOS on window.
    window.addEventListener("message", onMessage);
    document.addEventListener("message", onMessage);
    post({ type: "ready" });
  });
