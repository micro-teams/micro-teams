/*
 * The web half of TerminalView: xterm.js straight into this document — the page is a browser
 * already, so there is nothing to embed, and nothing for TerminalWarmup to start. Same props and
 * handle as TerminalView.tsx.
 */
import "@xterm/xterm/css/xterm.css";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { View } from "react-native";
import { fonts } from "../../ui/theme";
import { mountTerminal, type TerminalHandle } from "./page";
import type { TerminalViewHandle, TerminalViewProps } from "./TerminalView";

export const TerminalView = forwardRef<TerminalViewHandle, TerminalViewProps>(function TerminalView({ onMessage, style }, ref) {
  const host = useRef<HTMLElement | null>(null);
  const term = useRef<TerminalHandle | null>(null);
  const post = useRef(onMessage);
  useEffect(() => {
    post.current = onMessage;
  });
  useEffect(() => {
    // The face is loaded before the terminal measures its cell, or the cell is a fallback's.
    let gone = false;
    void Promise.all([document.fonts.load("13px LiberationMono"), document.fonts.load("bold 13px LiberationMono")])
      .catch(() => undefined)
      .then(() => {
        if (!gone) term.current = mountTerminal(host.current!, (m) => post.current(m), { fontFamily: fonts.mono });
      });
    return () => {
      gone = true;
      term.current?.dispose();
    };
  }, []);
  useImperativeHandle(
    ref,
    () => ({
      write: (bytes) => term.current?.write(bytes),
      size: (cols, rows) => term.current?.size(cols, rows),
      reset: () => term.current?.reset(),
      focus: (on) => term.current?.focus(on),
    }),
    [],
  );
  // On the web a View is a div, which is what xterm mounts on.
  return <View ref={(v) => void (host.current = v as unknown as HTMLElement | null)} style={style} testID="terminal" />;
});

export function TerminalWarmup() {
  return null;
}
