/*
 * The live screen's terminal, on any platform.
 *
 * <TerminalView ref onMessage style /> — draws a terminal in style's box, at the size it is given,
 *   centred. onMessage gets what the terminal says (page.ts's FromTerminal: its room, keys,
 *   rendered bytes, text to copy).
 *
 * TerminalViewHandle — the ref: write(bytes) puts screen bytes on it, size(cols, rows) sets its size
 *   after what was written before, reset() clears it for a new stream, focus(on) takes or gives up
 *   the keyboard. TerminalViewProps — the props above.
 * <TerminalWarmup /> — one terminal nobody sees, kept from the moment it is mounted: the first
 *   WebView a process makes starts the browser engine behind every later one, which on a phone
 *   costs most of a second, so a live screen opened later starts in a fraction of that.
 *
 * Example: <TerminalView ref={term} onMessage={handle} style={{ flex: 1 }} />
 *
 * On a phone it is xterm.js in a WebView, from a page built into the app (tool/terminal-html.mjs
 * writes page.generated.ts): nothing is fetched, so it works wherever the app does. Bytes go in as
 * base64 through postMessage; messages come out the same way. TerminalView.web.tsx is the web half.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { ComponentType, Ref } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import WebView, { type WebViewProps } from "react-native-webview";
import { TERMINAL_HTML } from "./page.generated";
import type { ToPage } from "./host";
import type { FromTerminal } from "./page";

export interface TerminalViewHandle {
  write(bytes: Uint8Array): void;
  size(cols: number, rows: number): void;
  reset(): void;
  focus(on: boolean): void;
}

export interface TerminalViewProps {
  onMessage: (m: FromTerminal) => void;
  style?: StyleProp<ViewStyle>;
}

// The class's own typings do not line up with React 19's JSX checks; the props are WebView's.
const Web = WebView as unknown as ComponentType<WebViewProps & { ref?: Ref<WebView> }>;

function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export const TerminalView = forwardRef<TerminalViewHandle, TerminalViewProps>(function TerminalView({ onMessage, style }, ref) {
  const web = useRef<WebView>(null);
  const born = useRef(0);
  useEffect(() => {
    born.current = Date.now();
  }, []);
  const ready = useRef(false);
  const queued = useRef<string[]>([]);
  const send = (m: ToPage) => {
    const text = JSON.stringify(m);
    if (ready.current) web.current?.postMessage(text);
    else queued.current.push(text);
  };
  useImperativeHandle(ref, () => ({
    write: (bytes) => send({ type: "write", data: base64(bytes) }),
    size: (cols, rows) => send({ type: "size", cols, rows }),
    reset: () => send({ type: "reset" }),
    focus: (on) => {
      // The page's own focus raises the keyboard only while the WebView itself has the focus.
      if (on) web.current?.requestFocus();
      send({ type: "focus", on });
    },
  }));
  return (
    <Web
      ref={web}
      testID="terminal"
      style={[{ backgroundColor: "#000" }, style]}
      originWhitelist={["*"]}
      source={{ html: TERMINAL_HTML }}
      javaScriptEnabled
      scrollEnabled={false}
      overScrollMode="never"
      keyboardDisplayRequiresUserAction={false}
      hideKeyboardAccessoryView
      onMessage={(e) => {
        const m = JSON.parse(e.nativeEvent.data) as FromTerminal | { type: "ready" };
        if (m.type === "ready") {
          console.log(`terminal: ready in ${Date.now() - born.current} ms`);
          ready.current = true;
          for (const t of queued.current.splice(0)) web.current?.postMessage(t);
          return;
        }
        onMessage(m);
      }}
    />
  );
});

export function TerminalWarmup() {
  // In a box of its own: the WebView component wraps itself in a view that grows to fill its
  // parent, so placed directly beside the app it would take half the window.
  return (
    <View pointerEvents="none" style={{ position: "absolute", width: 1, height: 1, opacity: 0, overflow: "hidden" }}>
      <TerminalView onMessage={() => {}} style={{ flex: 1 }} />
    </View>
  );
}
