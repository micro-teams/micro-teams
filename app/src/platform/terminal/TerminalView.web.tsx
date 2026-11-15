/*
 * The web half of TerminalView: xterm.js straight into this document — the page is a browser
 * already, so there is nothing to embed.
 */
import "@xterm/xterm/css/xterm.css";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { View } from "react-native";
import { fonts } from "../../ui/theme";
import { mountTerminal, type TerminalHandle } from "./page";
import type { TerminalViewHandle, TerminalViewProps } from "./TerminalView";

export const TerminalView = forwardRef<TerminalViewHandle, TerminalViewProps>(function TerminalView({ typing, onMessage, style }, ref) {
  const host = useRef<HTMLElement | null>(null);
  const term = useRef<TerminalHandle | null>(null);
  const post = useRef(onMessage);
  useEffect(() => {
    post.current = onMessage;
  });
  useEffect(() => {
    term.current = mountTerminal(host.current!, (m) => post.current(m), { fontFamily: fonts.mono });
    return () => term.current?.dispose();
  }, []);
  useEffect(() => term.current?.setTyping(typing), [typing]);
  useImperativeHandle(ref, () => ({ write: (bytes) => term.current?.write(bytes) }), []);
  // On the web a View is a div, which is what xterm mounts on.
  return <View ref={(v) => void (host.current = v as unknown as HTMLElement | null)} style={style} testID="terminal" />;
});
