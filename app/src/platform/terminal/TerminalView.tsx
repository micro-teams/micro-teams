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
 * base64 through postMessage; messages come out the same way. focus(true) goes through a native
 * field nobody sees: Android raises the keyboard for a page's own focus only after a touch inside
 * the page, so the field raises it and hands the focus on to the terminal, typing included (an
 * input method's composition, Chinese among it, is the WebView's as usual). TerminalView.web.tsx
 * is the web half.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { ComponentType, Ref } from "react";
import {
  StyleSheet,
  TextInput,
  type TextInputInstance,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
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
const Web = WebView as unknown as ComponentType<
  WebViewProps & { ref?: Ref<WebView> }
>;

function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export const TerminalView = forwardRef<TerminalViewHandle, TerminalViewProps>(
  function TerminalView({ onMessage, style }, ref) {
    const web = useRef<WebView>(null);
    const raiser = useRef<TextInputInstance>(null);
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
      // Android raises the keyboard for a page's focus only after a touch inside the page, so the
      // keyboard key first focuses a native field nobody sees, which raises it, and hands the focus
      // on to the terminal (raiser's onFocus); the keyboard stays up across that move.
      focus: (on) =>
        on ? raiser.current?.focus() : send({ type: "focus", on: false }),
    }));
    return (
      <View style={style}>
        <TextInput
          ref={raiser}
          style={styles.raiser}
          caretHidden
          showSoftInputOnFocus
          onFocus={() => {
            web.current?.requestFocus();
            send({ type: "focus", on: true });
          }}
        />
        <Web
          ref={web}
          testID="terminal"
          style={styles.web}
          originWhitelist={["*"]}
          source={{ html: TERMINAL_HTML }}
          javaScriptEnabled
          scrollEnabled={false}
          overScrollMode="never"
          keyboardDisplayRequiresUserAction={false}
          hideKeyboardAccessoryView
          onMessage={(e) => {
            const m = JSON.parse(e.nativeEvent.data) as
              FromTerminal | { type: "ready" };
            if (m.type === "ready") {
              console.log(`terminal: ready in ${Date.now() - born.current} ms`);
              ready.current = true;
              for (const t of queued.current.splice(0))
                web.current?.postMessage(t);
              return;
            }
            onMessage(m);
          }}
        />
      </View>
    );
  },
);

const styles = StyleSheet.create({
  web: { flex: 1, backgroundColor: "#000" },
  raiser: { position: "absolute", width: 1, height: 1, opacity: 0 },
});

export function TerminalWarmup() {
  // In a box of its own: the WebView component wraps itself in a view that grows to fill its
  // parent, so placed directly beside the app it would take half the window.
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        width: 1,
        height: 1,
        opacity: 0,
        overflow: "hidden",
      }}
    >
      <TerminalView onMessage={() => {}} style={{ flex: 1 }} />
    </View>
  );
}
