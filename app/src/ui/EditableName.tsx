/*
 * A name, with the way to change it beside it — for anything a person may rename: an agent, a
 * machine. The change happens in a dialog on the stack.
 *
 * <EditableName name onEdit testID? /> — the name in the page's title size, and a small pencil.
 *
 * Example: <EditableName name={machine.name} onEdit={rename} />
 */
import { MaterialIcons } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";
import { Txt } from "./kit";
import { colors } from "./theme";

export function EditableName({ name, onEdit, testID }: { name: string; onEdit: () => void; testID?: string }) {
  return (
    <View style={styles.row}>
      <Txt variant="title" numberOfLines={1} style={styles.name}>
        {name}
      </Txt>
      <Pressable testID={testID} accessibilityLabel={`rename ${name}`} hitSlop={10} onPress={onEdit} style={styles.edit}>
        <MaterialIcons name="edit" size={16} color={colors.inkMuted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  name: { flexShrink: 1, fontSize: 18 },
  edit: { padding: 4 },
});
