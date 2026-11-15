/*
 * The root frame of a section whose screens are not written yet: says so, rather than showing an
 * empty page that looks like a broken one.
 *
 * notBuilt(title) → a screen component for that section.
 *
 * Example: routes={{ docs: notBuilt("docs"), ... }}
 */
import { StyleSheet, View } from "react-native";
import { Header, Txt } from "../ui/kit";
import { colors } from "../ui/theme";

export function notBuilt(title: string) {
  return function NotBuilt() {
    return (
      <View style={styles.root}>
        <Header title={title} />
        <View style={styles.center}>
          <Txt muted>{`${title} is not built in this client yet`}</Txt>
        </View>
      </View>
    );
  };
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.page },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
