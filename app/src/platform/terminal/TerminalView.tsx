/*
 * The live screen's terminal, on any platform.
 *
 * <TerminalView ref typing onMessage style /> — draws a terminal filling style's box. ref.write(bytes)
 *   puts screen bytes on it; onMessage gets what the terminal says (page.ts's FromTerminal: keys,
 *   resize, scroll). typing hands it the keyboard; without it nothing typed comes out.
 *
 * TerminalViewHandle, TerminalViewProps — the ref's write(bytes), and the props above.
 *
 * Example: <TerminalView ref={term} typing={mode === "typing"} onMessage={handle} style={{ flex: 1 }} />
 *
 * On a phone it is xterm.js in a WebView, from a page built into the app (tool/terminal-html.mjs
 * writes page.generated.ts): nothing is fetched, so it works wherever the app does. Bytes go in as
 * base64 through postMessage; messages come out the same way. TerminalView.web.tsx is the web half.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { ComponentType, Ref } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import WebView, { type WebViewProps } from "react-native-webview";
import { TERMINAL_HTML } from "./page.generated";
import type { FromTerminal } from "./page";

export interface TerminalViewHandle {
  write(bytes: Uint8Array): void;
}

export interface TerminalViewProps {
  typing: boolean;
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

export const TerminalView = forwardRef<TerminalViewHandle, TerminalViewProps>(function TerminalView({ typing, onMessage, style }, ref) {
  const web = useRef<WebView>(null);
  const ready = useRef(false);
  const queued = useRef<string[]>([]);
  const send = (m: object) => {
    const text = JSON.stringify(m);
    if (ready.current) web.current?.postMessage(text);
    else queued.current.push(text);
  };
  useImperativeHandle(ref, () => ({ write: (bytes) => send({ type: "write", data: base64(bytes) }) }));
  useEffect(() => send({ type: "typing", on: typing }), [typing]);
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
          ready.current = true;
          for (const t of queued.current.splice(0)) web.current?.postMessage(t);
          return;
        }
        onMessage(m);
      }}
    />
  );
});
