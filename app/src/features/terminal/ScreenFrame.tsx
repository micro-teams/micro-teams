/*
 * An agent's live screen, over whatever you were doing — a frame on the display stack, so back
 * closes it and everything under it is where you left it.
 *
 * <ScreenFrame /> — drawn for a "screen" overlay frame with { sessionId }. One row of chrome above
 *   the terminal (a terminal is the content; the chrome is a tax on how many lines you see): close,
 *   the three modes — watching, history, typing — as icons, "the agent is not driving" while
 *   typing, and compact. While the socket is down one row says it is reconnecting, and once
 *   several attempts have never connected, that the screen may be gone or not yours to watch, with
 *   a way to try now.
 *
 * Example: push("screen", "overlay", { sessionId: agent.sid })
 */
import { MaterialIcons } from "@expo/vector-icons";
import { useRef } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLiveScreen, type ViewMode } from "../../data/screen";
import { useFrame, useNav } from "../../nav/NavProvider";
import { TerminalView, type TerminalViewHandle } from "../../platform/terminal/TerminalView";
import { Txt } from "../../ui/kit";
import { colors } from "../../ui/theme";

const MODES: { mode: ViewMode; icon: keyof typeof MaterialIcons.glyphMap; label: string }[] = [
  { mode: "watching", icon: "visibility", label: "watching" },
  { mode: "history", icon: "history", label: "history" },
  { mode: "typing", icon: "keyboard", label: "typing" },
];

function Small({ icon, label, selected, onPress, testID }: { icon: keyof typeof MaterialIcons.glyphMap; label: string; selected?: boolean; onPress: () => void; testID?: string }) {
  return (
    <Pressable testID={testID} accessibilityLabel={label} onPress={onPress} hitSlop={6} style={[styles.small, selected && styles.selected]}>
      <MaterialIcons name={icon} size={16} color={selected ? colors.brand : colors.inkMuted} />
    </Pressable>
  );
}

export function ScreenFrame() {
  const { sessionId } = useFrame().params as { sessionId: string };
  const { pop } = useNav();
  const insets = useSafeAreaInsets();
  const term = useRef<TerminalViewHandle>(null);
  const { state, screen } = useLiveScreen(sessionId, (bytes) => term.current?.write(bytes));

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="screen">
      <View style={styles.chrome}>
        <Small testID="screen-close" icon="close" label="close" onPress={pop} />
        <View style={styles.gap} />
        {MODES.map((m) => (
          <Small key={m.mode} testID={`screen-${m.mode}`} icon={m.icon} label={m.label} selected={state.mode === m.mode} onPress={() => screen.setMode(m.mode)} />
        ))}
        <View style={styles.spacer} />
        {state.mode === "typing" && (
          <Txt variant="label" muted style={styles.note}>
            the agent is not driving
          </Txt>
        )}
        <Small testID="screen-compact" icon="compress" label="compact" onPress={() => screen.compact()} />
      </View>
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
      <TerminalView
        ref={term}
        typing={state.mode === "typing"}
        style={[styles.terminal, { marginBottom: insets.bottom }]}
        onMessage={(m) => {
          if (m.type === "keys") screen.keys(m.data);
          else if (m.type === "resize") screen.resize(m.cols, m.rows);
          else screen.scroll(m.dir);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill, backgroundColor: "#000" },
  chrome: { flexDirection: "row", alignItems: "center", backgroundColor: colors.raised, paddingHorizontal: 4, paddingVertical: 2 },
  small: { width: 28, height: 28, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  selected: { backgroundColor: colors.page },
  gap: { width: 4 },
  spacer: { flex: 1 },
  note: { marginRight: 6 },
  banner: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.hover },
  doubtful: { backgroundColor: "#3A1416" },
  bannerText: { flex: 1 },
  terminal: { flex: 1 },
});
