/*
 * A choice of one among a few, laid out as bordered chips that wrap: a machine, a driver, a
 * protocol. The chosen one is outlined in the brand green.
 *
 * <Choices options={[{ value, label }]} value onChange testIDPrefix? /> — testIDs are
 *   `${testIDPrefix}-${value}`.
 *
 * Example: <Choices options={drivers.map((d) => ({ value: d, label: d }))} value={driver} onChange={setDriver} />
 */
import { StyleSheet, View } from "react-native";
import { Pressy, Txt } from "./kit";
import { colors } from "./theme";

export function Choices<T extends string>({
  options,
  value,
  onChange,
  testIDPrefix,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  testIDPrefix?: string;
}) {
  return (
    <View style={styles.row}>
      {options.map((o) => {
        const chosen = o.value === value;
        return (
          <Pressy key={o.value} testID={testIDPrefix ? `${testIDPrefix}-${o.value}` : undefined} onPress={() => onChange(o.value)} style={[styles.chip, chosen && styles.chosen]}>
            <Txt style={chosen ? { color: colors.brand } : undefined}>{o.label}</Txt>
          </Pressy>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 },
  chosen: { borderColor: colors.brand },
});
