/*
 * A row of a plain list: something to show on the left, a title, a line under it, and the whole
 * row tappable. The agents and machines lists are made of these; the chat list has its own row
 * because its title line carries a time.
 *
 * <ListRow leading title subtitle? onPress testID? selected?> — selected tints the row: the one
 *   whose detail is showing beside the list in a wide window.
 * <OnlineDot online label?> — green when online, grey when not; label writes the word beside it.
 *
 * Example: <ListRow leading={<Avatar userId={7} />} title="alice" subtitle={<OnlineDot online />} onPress={open} />
 */
import { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Pressy, Txt } from "./kit";
import { colors } from "./theme";

export function ListRow({
  leading,
  title,
  subtitle,
  onPress,
  testID,
  selected,
}: {
  leading: ReactNode;
  title: string;
  subtitle?: ReactNode;
  onPress: () => void;
  testID?: string;
  selected?: boolean;
}) {
  return (
    <Pressy testID={testID} onPress={onPress} style={[styles.row, selected && styles.selected]}>
      {leading}
      <View style={styles.text}>
        <Txt numberOfLines={1} style={styles.title}>
          {title}
        </Txt>
        {subtitle ? <View style={styles.subtitle}>{subtitle}</View> : null}
      </View>
    </Pressy>
  );
}

export function OnlineDot({ online, label }: { online: boolean; label?: boolean }) {
  const dot = <View accessibilityLabel={online ? "online" : "offline"} style={[styles.dot, { backgroundColor: online ? colors.brand : colors.inkMuted }]} />;
  if (!label) return dot;
  return (
    <View style={styles.labelled}>
      {dot}
      <Txt variant="small" muted>
        {online ? "online" : "offline"}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 8 },
  selected: { backgroundColor: colors.raised },
  text: { flex: 1, marginLeft: 12 },
  title: { fontWeight: "500" },
  subtitle: { flexDirection: "row", alignItems: "center", marginTop: 4, gap: 6 },
  labelled: { flexDirection: "row", alignItems: "center", gap: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
