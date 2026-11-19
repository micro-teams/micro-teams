/*
 * What something is, as a bordered list of label / value rows.
 *
 * <Facts rows={[{ label, value, onPress?, testID? }]} /> — a row with onPress is tappable and ends
 *   in a chevron; values are selectable, so an id can be copied out. Rows with no value are left
 *   out.
 *
 * Fact — one row: { label, value?, onPress?, testID? }.
 *
 * Example: <Facts rows={[{ label: "user id", value: "42" }, { label: "version", value: v, onPress: info }]} />
 */
import { MaterialIcons } from "@expo/vector-icons";
import { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Pressy, Txt } from "./kit";
import { colors } from "./theme";

export type Fact = { label: string; value?: ReactNode; onPress?: () => void; testID?: string };

export function Facts({ rows }: { rows: Fact[] }) {
  const shown = rows.filter((r) => r.value !== undefined && r.value !== null && r.value !== "");
  return (
    <View style={styles.card}>
      {shown.map((r, i) => {
        const body = (
          <>
            <Txt muted style={styles.label}>
              {r.label}
            </Txt>
            <View style={styles.value}>{typeof r.value === "string" ? <Txt selectable>{r.value}</Txt> : r.value}</View>
            {r.onPress ? <MaterialIcons name="chevron-right" size={16} color={colors.inkMuted} /> : null}
          </>
        );
        const style = [styles.row, i > 0 && styles.divided];
        return r.onPress ? (
          <Pressy key={r.label} testID={r.testID} onPress={r.onPress} style={style}>
            {body}
          </Pressy>
        ) : (
          <View key={r.label} testID={r.testID} style={style}>
            {body}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: colors.line, borderRadius: 8, backgroundColor: colors.card, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, gap: 12 },
  divided: { borderTopWidth: 1, borderTopColor: colors.line },
  label: { width: 96 },
  value: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6 },
});
