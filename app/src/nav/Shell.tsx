/*
 * The one shell: draws the display stack for the window it is in.
 *
 * <Shell routes> — routes maps a frame's route name to the screen drawn for it.
 * SECTIONS — the destinations, in order, with their icons.
 *
 * Example: <Shell routes={{ chats: ChatsScreen, thread: ThreadScreen, dialog: DialogFrame }} />
 *
 * The layout is a function of the stack and the width, and nothing else:
 *   - narrow: the top opaque frame fills the window; the tab bar shows only at a section's root,
 *     the way WeChat hides it inside a conversation;
 *   - wide: the rail, the section's root list, and beside it the top opaque frame above the root.
 * Overlays (dialogs, the live screen) are drawn over all of it either way.
 *
 * Every stack that has been opened stays mounted, hidden while it is not on screen, so switching
 * sections or teams and coming back finds the conversation, its scroll position and the half-typed
 * message where they were.
 */
import { MaterialIcons } from "@expo/vector-icons";
import type { ComponentType } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Txt } from "../ui/kit";
import { colors, metrics, WIDE } from "../ui/theme";
import { FrameProvider, useNav } from "./NavProvider";
import { Frame, Nav, Section, stackKey, stackOf } from "./stack";

type Icon = keyof typeof MaterialIcons.glyphMap;

export const SECTIONS: { section: Section; label: string; icon: Icon }[] = [
  { section: "chats", label: "chats", icon: "forum" },
  { section: "docs", label: "docs", icon: "snippet-folder" },
  { section: "agents", label: "agents", icon: "smart-toy" },
  { section: "me", label: "me", icon: "person" },
];

type Routes = Record<string, ComponentType>;

function Drawn({ frame, routes, visible }: { frame: Frame; routes: Routes; visible: boolean }) {
  const Screen = routes[frame.route];
  if (!Screen) throw new Error(`no screen for route "${frame.route}"`);
  return (
    <View style={[StyleSheet.absoluteFill, !visible && styles.hidden]}>
      <FrameProvider frame={frame}>
        <Screen />
      </FrameProvider>
    </View>
  );
}

/** Index of the top frame that is not an overlay. */
function topOpaque(stack: Frame[]): number {
  for (let i = stack.length - 1; i >= 0; i--) if (stack[i].kind !== "overlay") return i;
  return 0;
}

function StackView({ stack, routes, wide, onScreen }: { stack: Frame[]; routes: Routes; wide: boolean; onScreen: boolean }) {
  const shown = topOpaque(stack);
  if (!wide) {
    return (
      <View style={[StyleSheet.absoluteFill, !onScreen && styles.hidden]}>
        {stack.map((f, i) => (
          <Drawn key={f.key} frame={f} routes={routes} visible={i === shown || i > shown} />
        ))}
      </View>
    );
  }
  const detail = shown > 0 ? shown : -1;
  return (
    <View style={[StyleSheet.absoluteFill, styles.row, !onScreen && styles.hidden]}>
      <View style={styles.listPane}>
        <Drawn frame={stack[0]} routes={routes} visible />
      </View>
      <View style={styles.detailPane}>
        {detail < 0 && (
          <View style={styles.empty}>
            <Txt muted>pick something on the left</Txt>
          </View>
        )}
        {stack.slice(1).map((f, j) =>
          f.kind === "overlay" ? null : <Drawn key={f.key} frame={f} routes={routes} visible={j + 1 === detail} />,
        )}
      </View>
      {stack.map((f, i) =>
        f.kind === "overlay" && i > shown ? <Drawn key={f.key} frame={f} routes={routes} visible /> : null,
      )}
    </View>
  );
}

function Destinations({ nav, vertical, onPick }: { nav: Nav; vertical: boolean; onPick: (s: Section) => void }) {
  return (
    <View style={vertical ? styles.rail : styles.tabs}>
      {SECTIONS.map(({ section, label, icon }) => {
        const active = nav.section === section;
        const colour = active ? colors.brand : colors.inkMuted;
        return (
          <Pressable
            key={section}
            testID={`destination-${label}`}
            onPress={() => onPick(section)}
            style={[styles.destination, active && { backgroundColor: colors.hover }]}
          >
            <MaterialIcons name={icon} size={metrics.railIcon} color={colour} />
            <Txt style={{ fontSize: metrics.railLabel, color: colour, marginTop: 2 }}>{label}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Shell({ routes }: { routes: Routes }) {
  const { nav, switchSection } = useNav();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE;
  const currentKey = stackKey(nav.section, nav.team);
  const keys = new Set([...Object.keys(nav.stacks), currentKey]);
  const atRoot = topOpaque(stackOf(nav)) === 0;

  const stacks = [...keys].map((key) => (
    <StackView
      key={key}
      stack={key === currentKey ? stackOf(nav) : nav.stacks[key]}
      routes={routes}
      wide={wide}
      onScreen={key === currentKey}
    />
  ));

  return (
    <SafeAreaView style={[styles.root, wide && styles.row]} edges={["top", "bottom"]}>
      {wide && <Destinations nav={nav} vertical onPick={switchSection} />}
      <View style={styles.body}>{stacks}</View>
      {!wide && atRoot && <Destinations nav={nav} vertical={false} onPick={switchSection} />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.page },
  row: { flexDirection: "row" },
  body: { flex: 1 },
  hidden: { display: "none" },
  listPane: { width: metrics.listPane, borderRightWidth: 1, borderRightColor: colors.line },
  detailPane: { flex: 1 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center" },
  rail: {
    width: metrics.railWidth,
    paddingVertical: 12,
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.card,
    borderRightWidth: 1,
    borderRightColor: colors.line,
  },
  tabs: {
    flexDirection: "row",
    justifyContent: "space-evenly",
    paddingVertical: 6,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  destination: {
    width: metrics.railItem,
    height: metrics.railItem,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
});
