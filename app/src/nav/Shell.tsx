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
import { useSession } from "../data/session";
import { Avatar } from "../ui/Avatar";
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
        {stack.map((f, i) => (f.kind === "overlay" ? null : <Drawn key={f.key} frame={f} routes={routes} visible={i === shown} />))}
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
    </View>
  );
}

function Destinations({ nav, vertical, onPick }: { nav: Nav; vertical: boolean; onPick: (s: Section) => void }) {
  const { user } = useSession();
  // The rail has three, with your own face pinned at the bottom for "me": the only thing on a wide
  // window that says who is signed in. A phone has nowhere to
  // pin a face, so its bar has "me" as a fourth button.
  const items = vertical ? SECTIONS.filter((s) => s.section !== "me") : SECTIONS;
  return (
    <View style={vertical ? styles.rail : styles.tabs}>
      {items.map(({ section, label, icon }) => {
        const active = nav.section === section;
        const colour = active ? colors.brand : colors.inkMuted;
        return (
          <Pressable
            key={section}
            testID={`destination-${label}`}
            onPress={() => onPick(section)}
            style={[styles.destination, active && { backgroundColor: colors.hover }]}
          >
            {/* A glyph's box is as tall as the icon font's line, not the icon: pinned, or the label sits low. */}
            <MaterialIcons name={icon} size={metrics.railIcon} color={colour} style={styles.icon} />
            <Txt style={[styles.label, { color: colour }]}>{label}</Txt>
          </Pressable>
        );
      })}
      {vertical && user ? (
        <>
          <View style={styles.grow} />
          <Pressable testID="destination-me" accessibilityLabel={user.nickname} onPress={() => onPick("me")} style={[styles.me, nav.section === "me" && { backgroundColor: colors.hover }]}>
            <Avatar userId={user.id} nickname={user.nickname} avatarId={user.avatarId} size={36} />
          </Pressable>
        </>
      ) : null}
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

  // Overlays — dialogs, the live screen — over the whole window, rail and tab bar included: a
  // terminal gets every pixel there is, and a dialog's scrim dims everything behind it. Every
  // stack's overlays stay mounted (a live screen keeps its connection while you look elsewhere);
  // only the current stack's are shown.
  const overlays = [...keys].flatMap((key) => {
    const stack = key === currentKey ? stackOf(nav) : nav.stacks[key];
    const shown = topOpaque(stack);
    return stack.map((f, i) => (f.kind === "overlay" && i > shown ? <Drawn key={f.key} frame={f} routes={routes} visible={key === currentKey} /> : null));
  });

  return (
    <View style={styles.root}>
      <SafeAreaView style={[styles.root, wide && styles.row]} edges={["top", "bottom"]}>
        {wide && <Destinations nav={nav} vertical onPick={switchSection} />}
        <View style={styles.body}>{stacks}</View>
        {!wide && atRoot && <Destinations nav={nav} vertical={false} onPick={switchSection} />}
      </SafeAreaView>
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {overlays}
      </View>
    </View>
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
  icon: { width: metrics.railIcon, height: metrics.railIcon, lineHeight: metrics.railIcon, textAlign: "center" },
  label: { fontSize: metrics.railLabel, lineHeight: 12, marginTop: 2 },
  grow: { flex: 1 },
  me: { padding: 4, borderRadius: metrics.avatarRadius },
  destination: {
    width: metrics.railItem,
    height: metrics.railItem,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
});
