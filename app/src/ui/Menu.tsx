/*
 * The one menu in the app: a list of choices that drops from what opened it — the previous
 * client's AppMenu — and the drop-down built from it.
 *
 * <MenuButton items onSelected testID? style?>{opener}</MenuButton> — tapping the opener drops the
 *   menu under it. items are { value, label, checked?, danger?, testID? } and "divider"s.
 * <Select value options onChange testID? placeholder?> — a drop-down, as on a desktop: the chosen
 *   label with a caret, opening a menu with the chosen one ticked.
 * <MenuFrame> — what the route table draws for the "menu" overlay frame.
 *
 * Example:
 *   <MenuButton items={[{ value: "rename", label: "rename" }, "divider", { value: "delete", label: "delete", danger: true }]}
 *     onSelected={act}><Txt>⋯</Txt></MenuButton>
 *
 * A frame on the display stack, like a dialog: back closes the menu, not the page under it. It
 * appears at once, under its opener — above it when there is no room below — never past the
 * window, and scrolls when it has more choices than fit. A tap anywhere else closes it.
 */
import { MaterialIcons } from "@expo/vector-icons";
import { ReactNode, useRef } from "react";
import { HostInstance, Pressable, ScrollView, StyleProp, StyleSheet, useWindowDimensions, View, ViewStyle } from "react-native";
import { useFrame, useNav } from "../nav/NavProvider";
import { Pressy, Txt } from "./kit";
import { colors } from "./theme";

export type MenuItem<T> = { value: T; label: string; checked?: boolean; danger?: boolean; testID?: string } | "divider";

type Rect = { x: number; y: number; width: number; height: number };
type Params = { items: MenuItem<unknown>[]; anchor: Rect; minWidth: number; pick: (v: unknown) => void };

const ROW = 34;
const MARGIN = 8;

function useOpenMenu() {
  const { push } = useNav();
  return <T,>(anchor: Rect, items: MenuItem<T>[], onSelected: (v: T) => void, minWidth = 0) =>
    push("menu", "overlay", { items, anchor, minWidth, pick: onSelected as (v: unknown) => void } satisfies Params);
}

function measure(view: HostInstance | null): Promise<Rect | null> {
  return new Promise((resolve) => {
    if (!view) return resolve(null);
    view.measureInWindow((x, y, width, height) => resolve({ x, y, width, height }));
  });
}

export function MenuButton<T>({
  items,
  onSelected,
  children,
  testID,
  style,
  accessibilityLabel,
  matchWidth,
}: {
  items: MenuItem<T>[];
  onSelected: (v: T) => void;
  children: ReactNode;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  /** The menu at least as wide as its opener: a drop-down's list lines up with its box. */
  matchWidth?: boolean;
}) {
  const ref = useRef<HostInstance>(null);
  const open = useOpenMenu();
  return (
    <Pressable
      ref={ref}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={6}
      style={style}
      onPress={async () => {
        const anchor = await measure(ref.current);
        if (anchor) open(anchor, items, onSelected, matchWidth ? anchor.width : 0);
      }}
    >
      {children}
    </Pressable>
  );
}

export function Select<T extends string | number>({
  value,
  options,
  onChange,
  testID,
  placeholder = "choose…",
}: {
  value: T | null;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  testID?: string;
  placeholder?: string;
}) {
  const chosen = options.find((o) => o.value === value);
  return (
    <MenuButton
      testID={testID}
      matchWidth
      items={options.map((o) => ({ value: o.value, label: o.label, checked: o.value === value, testID: testID ? `${testID}-${o.value}` : undefined }))}
      onSelected={onChange}
      style={styles.select}
    >
      <Txt numberOfLines={1} muted={!chosen} style={styles.grow}>
        {chosen?.label ?? placeholder}
      </Txt>
      <MaterialIcons name="expand-more" size={18} color={colors.inkMuted} />
    </MenuButton>
  );
}

export function MenuFrame() {
  const { pop } = useNav();
  const params = useFrame().params as Params;
  const window = useWindowDimensions();

  const { anchor, items } = params;
  const natural = items.reduce((h, i) => h + (i === "divider" ? 9 : ROW), 8);
  const below = window.height - (anchor.y + anchor.height) - MARGIN;
  const above = anchor.y - MARGIN;
  const down = below >= Math.min(natural, 240) || below >= above;
  const maxHeight = Math.max(ROW * 2, down ? below : above);
  const width = Math.min(Math.max(params.minWidth, 180), window.width - MARGIN * 2);
  const left = Math.max(MARGIN, Math.min(anchor.x, window.width - width - MARGIN));
  const position = down ? { top: anchor.y + anchor.height + 2 } : { bottom: window.height - anchor.y + 2 };

  const choose = (v: unknown) => {
    pop();
    params.pick(v);
  };

  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable testID="menu-scrim" accessibilityLabel="dismiss" style={StyleSheet.absoluteFill} onPress={pop} />
      <View testID="menu" style={[styles.menu, position, { left, width, maxHeight }]}>
        <ScrollView>
          {items.map((item, i) =>
            item === "divider" ? (
              <View key={`d${i}`} style={styles.divider} />
            ) : (
              <Pressy key={`${i}`} testID={item.testID} onPress={() => choose(item.value)} style={styles.item}>
                <View style={styles.tick}>{item.checked ? <MaterialIcons name="check" size={16} color={colors.brand} /> : null}</View>
                <Txt numberOfLines={1} style={[styles.grow, item.danger && { color: colors.danger }]}>
                  {item.label}
                </Txt>
              </Pressy>
            ),
          )}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  menu: {
    position: "absolute",
    backgroundColor: colors.raised,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 4,
    overflow: "hidden",
  },
  item: { flexDirection: "row", alignItems: "center", height: ROW, paddingHorizontal: 12, gap: 8 },
  tick: { width: 16 },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: 4 },
  grow: { flex: 1 },
  select: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
});
