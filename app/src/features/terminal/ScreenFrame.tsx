/*
 * An agent's live screen, over whatever you were doing — a frame on the display stack, so back
 * closes it and everything under it is where you left it.
 *
 * <ScreenFrame /> — drawn for a "screen" overlay frame with { sessionId }. One row of chrome above
 *   the terminal (a terminal is the content; the chrome is a tax on how many lines you see): close;
 *   who has the input (free, you, the agent, or another person by name — whoever types first takes
 *   it, and input while someone else has it is refused and said so); the terminal's size; the
 *   agent's usage, which the agent's program shows in the terminal; copy, which opens the screen's
 *   text with its history as plain selectable text; and compact. What a button did, or why it could
 *   not, is a note over the terminal for a few seconds. On a device with a screen keyboard
 *   a row of the keys it lacks sits under the terminal: Esc, Ctrl (applies to the next key), Tab,
 *   the arrows, and the keyboard itself.
 *
 *   Nothing that comes and goes changes the terminal's room: the connecting and reconnecting notes
 *   lie over the terminal, the key row is always there where it is shown at all, and the keyboard
 *   takes its room once as it starts to open and gives it back once as it starts to close.
 *
 * Example: push("screen", "overlay", { sessionId: agent.sid })
 */
import { MaterialIcons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, type ScrollViewInstance } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLiveScreen, type ScreenState } from "../../data/screen";
import { useFrame, useNav } from "../../nav/NavProvider";
import { hasTouchKeyboard, keyboardInsetKnown, useKeyboardInset } from "../../platform/keyboardInset";
import { TerminalView, type TerminalViewHandle } from "../../platform/terminal/TerminalView";
import { Txt } from "../../ui/kit";
import { colors, fonts } from "../../ui/theme";

/** How long a note (copied, or what went wrong with a button) stays over the terminal. */
const NOTE_MS = 4_000;

type Icon = keyof typeof MaterialIcons.glyphMap;

const KEYS: { label: string; seq: string; testID: string }[] = [
  { label: "Esc", seq: "\x1b", testID: "screen-key-esc" },
  { label: "Tab", seq: "\t", testID: "screen-key-tab" },
  { label: "←", seq: "\x1b[D", testID: "screen-key-left" },
  { label: "↑", seq: "\x1b[A", testID: "screen-key-up" },
  { label: "↓", seq: "\x1b[B", testID: "screen-key-down" },
  { label: "→", seq: "\x1b[C", testID: "screen-key-right" },
];

function Small({ icon, label, onPress, testID }: { icon: Icon; label: string; onPress: () => void; testID: string }) {
  return (
    <Pressable testID={testID} accessibilityLabel={label} onPress={onPress} hitSlop={6} style={styles.small}>
      <MaterialIcons name={icon} size={16} color={colors.inkMuted} />
    </Pressable>
  );
}

function leaseText(s: ScreenState): string {
  switch (s.lease.holder) {
    case "self":
      return "you are typing";
    case "driver":
      return "the agent is typing";
    case "other":
      return `${s.lease.name ?? "someone"} is typing`;
    default:
      return "free";
  }
}

/** A key typed while Ctrl is armed: a letter or one of @[\]^_ becomes its control character. */
function withCtrl(data: string): string {
  if (data.length !== 1) return data;
  const c = data.toUpperCase().charCodeAt(0);
  return c >= 0x40 && c <= 0x5f ? String.fromCharCode(c & 0x1f) : data;
}

export function ScreenFrame() {
  const { sessionId } = useFrame().params as { sessionId: string };
  const { pop } = useNav();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardInset();
  const term = useRef<TerminalViewHandle>(null);
  const { state, screen } = useLiveScreen(sessionId);
  const [ctrl, setCtrl] = useState(false);
  const [focused, setFocused] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = (text: string) => {
    setNote(text);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(null), NOTE_MS);
  };
  useEffect(
    () => () => {
      if (noteTimer.current) clearTimeout(noteTimer.current);
    },
    [],
  );
  const toClipboard = (text: string) =>
    Clipboard.setStringAsync(text).then(
      (ok) => notify(ok ? "copied" : "copy: the clipboard refused the text"),
      (e: Error) => notify(`copy: ${e.message}`),
    );
  // The copy sheet opens at its end, where the latest lines are, once per text it is given.
  const sheetAtEnd = useRef(false);
  const sheet = useRef<ScrollViewInstance>(null);
  const opened = useRef({ at: 0, steps: [] as string[], done: false });

  useEffect(() => {
    opened.current.at = Date.now();
    screen.drawOn({
      write: (b) => term.current?.write(b),
      size: (c, r) => term.current?.size(c, r),
      reset: () => term.current?.reset(),
    });
  }, [screen]);

  // How long opening took, step by step: the console is where a slow open is diagnosed.
  const step = (name: string) => {
    const o = opened.current;
    if (o.done || o.steps.some((s) => s.startsWith(`${name} `))) return;
    o.steps.push(`${name} ${Date.now() - o.at}`);
    if (name === "drawn") {
      o.done = true;
      console.log(`screen: opened in ${Date.now() - o.at} ms (${o.steps.join(", ")})`);
    }
  };
  useEffect(() => {
    if (state.connected) step("socket");
  }, [state.connected]);
  useEffect(() => {
    if (state.size) step("size");
  }, [state.size]);
  useEffect(() => {
    if (state.drawn) step("drawn");
  }, [state.drawn]);

  const send = (data: string, typed = true) => {
    if (!typed) return screen.input(data, false);
    screen.input(ctrl ? withCtrl(data) : data);
    if (ctrl) setCtrl(false);
  };
  // Where the platform reports the keyboard itself, that is what the key shows; on the web, whether
  // the terminal has the focus.
  const keyboardOpen = keyboardInsetKnown ? keyboard > 0 : focused;

  const ask = (name: "usage" | "compact") =>
    screen.command(name).then(
      () => notify(`${name}: asked; the agent's program shows it`),
      (e: Error) => notify(`${name}: ${e.message}`),
    );
  const copy = () =>
    screen.capture().then(
      (text) => {
        sheetAtEnd.current = false;
        setCopied(text.replace(/\s+$/, ""));
      },
      (e: Error) => notify(`copy: ${e.message}`),
    );

  const size = state.size;
  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="screen">
      <View style={styles.chrome}>
        <Small testID="screen-close" icon="close" label="close" onPress={pop} />
        <Txt testID="screen-lease" variant="label" muted={state.lease.holder === "free"} style={styles.lease} numberOfLines={1}>
          {leaseText(state)}
        </Txt>
        {size && (
          <View testID="screen-size-info" accessible accessibilityLabel={`terminal ${size.cols}x${size.rows}, resized ${state.resizes} times`} style={styles.size}>
            <Txt testID="screen-size" variant="label" muted>
              {`${size.cols}×${size.rows}`}
            </Txt>
          </View>
        )}
        {state.commands.includes("usage") && <Small testID="screen-usage" icon="data-usage" label="usage" onPress={() => void ask("usage")} />}
        <Small testID="screen-copy" icon="content-copy" label="copy" onPress={copy} />
        {state.commands.includes("compact") && <Small testID="screen-compact" icon="compress" label="compact" onPress={() => void ask("compact")} />}
      </View>
      <View style={[styles.body, { marginBottom: Math.max(insets.bottom, keyboard) }]}>
        <View style={styles.terminal}>
          <TerminalView
            ref={term}
            style={styles.fill}
            onMessage={(m) => {
              if (m.type === "keys") send(m.data, m.typed);
              else if (m.type === "rendered") screen.rendered(m.n);
              else if (m.type === "copy") void toClipboard(m.text);
              else if (m.type === "focus") setFocused(m.on);
              // A new terminal, empty: a new connection paints it whole.
              else if (m.type === "lost") screen.retry();
              else if (m.type === "room") {
                step("terminal");
                screen.room(m.cols, m.rows);
              }
            }}
          />
          {!state.drawn && !state.reconnecting && (
            <View testID="screen-connecting" style={styles.banner} pointerEvents="none">
              <ActivityIndicator size="small" color={colors.ink} />
              <Txt variant="small" style={styles.bannerText}>
                {state.error ?? "connecting…"}
              </Txt>
            </View>
          )}
          {state.reconnecting && (
            <Pressable onPress={() => screen.retry()} style={[styles.banner, state.doubtful && styles.doubtful]}>
              <ActivityIndicator size="small" color={colors.ink} />
              <Txt variant="small" style={styles.bannerText}>
                {state.doubtful ? "still trying — this screen may be gone, or not yours to watch" : "reconnecting…"}
              </Txt>
              <Txt variant="small" style={{ color: colors.brand }}>
                try now
              </Txt>
            </Pressable>
          )}
          {note !== null && (
            <View style={styles.banner} pointerEvents="none">
              <Txt testID="screen-note" variant="small" style={styles.bannerText}>
                {note}
              </Txt>
            </View>
          )}
          {state.refused && (
            <View testID="screen-refused" style={[styles.banner, styles.refused]} pointerEvents="none">
              <Txt variant="small" style={styles.bannerText}>
                {`${state.refused} has the input: what you typed was not sent`}
              </Txt>
            </View>
          )}
        </View>
        {hasTouchKeyboard && (
          <View style={styles.keys}>
            <Pressable testID="screen-key-ctrl" onPress={() => setCtrl(!ctrl)} style={[styles.key, ctrl && styles.armed]}>
              <Txt variant="label">Ctrl</Txt>
            </Pressable>
            {KEYS.map((k) => (
              <Pressable key={k.testID} testID={k.testID} onPress={() => send(k.seq)} style={styles.key}>
                <Txt variant="label">{k.label}</Txt>
              </Pressable>
            ))}
            <Pressable testID="screen-keyboard" accessibilityLabel="keyboard" onPress={() => term.current?.focus(!keyboardOpen)} style={styles.key}>
              <MaterialIcons name={keyboardOpen ? "keyboard-hide" : "keyboard"} size={16} color={colors.ink} />
            </Pressable>
          </View>
        )}
        {copied !== null && (
          <View testID="screen-copy-sheet" style={styles.sheet}>
            <View style={styles.chrome}>
              <Small testID="screen-copy-close" icon="close" label="close" onPress={() => setCopied(null)} />
              <View style={styles.spacer} />
              <Pressable testID="screen-copy-all" onPress={() => void toClipboard(copied)} style={styles.key}>
                <Txt variant="label">copy all</Txt>
              </Pressable>
            </View>
            <ScrollView
              ref={sheet}
              onContentSizeChange={() => {
                if (sheetAtEnd.current) return;
                sheetAtEnd.current = true;
                sheet.current?.scrollToEnd({ animated: false });
              }}
              contentContainerStyle={styles.sheetBody}
            >
              <Text testID="screen-copy-text" selectable style={styles.copyText}>
                {copied}
              </Text>
            </ScrollView>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill, backgroundColor: "#000" },
  chrome: { flexDirection: "row", alignItems: "center", backgroundColor: colors.raised, paddingHorizontal: 4, paddingVertical: 2, gap: 2 },
  small: { width: 28, height: 28, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  lease: { flex: 1, marginHorizontal: 6 },
  size: { marginRight: 4 },
  spacer: { flex: 1 },
  body: { flex: 1 },
  terminal: { flex: 1 },
  fill: { flex: 1 },
  banner: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.hover,
  },
  doubtful: { backgroundColor: "#3A1416" },
  refused: { backgroundColor: "#3A2A10" },
  bannerText: { flex: 1 },
  keys: { flexDirection: "row", backgroundColor: colors.raised, paddingHorizontal: 2, paddingVertical: 3, gap: 3 },
  key: { flex: 1, height: 32, minWidth: 36, paddingHorizontal: 6, borderRadius: 6, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  armed: { backgroundColor: colors.brand },
  sheet: { ...StyleSheet.absoluteFill, backgroundColor: colors.page },
  sheetBody: { padding: 8 },
  copyText: { fontFamily: fonts.mono, fontSize: 12, lineHeight: 16, color: colors.ink },
});
