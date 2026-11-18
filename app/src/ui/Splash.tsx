/*
 * What is on screen while the app gets ready, so that nothing assembles itself in front of the
 * reader: the name on black, a word under it, and after twenty seconds an admission that it is
 * taking too long, with the two things that help.
 *
 * <Splash /> — drawn over everything until the first screen is complete (App.tsx decides when).
 * On the web public/index.html shows the same thing from the first byte, before any script runs.
 *
 * Example: {!ready && <Splash />}
 */
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { isWeb } from "../platform/platform";

const SLOW_MS = 20_000;

export function Splash() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(t);
  }, []);
  return (
    <View style={styles.root} testID="splash">
      <Text style={styles.name}>MicroTeams</Text>
      <Text style={styles.muted}>loading…</Text>
      {slow && (
        <View style={styles.slow}>
          <Text style={styles.small}>This is taking longer than it should.</Text>
          {isWeb && (
            <Pressable onPress={() => window.location.reload()}>
              <Text style={[styles.small, styles.link]}>try again</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill, backgroundColor: "#060606", alignItems: "center", justifyContent: "center", gap: 12, zIndex: 1000 },
  name: { color: "#f5f5f5", fontSize: 15, fontWeight: "500" },
  muted: { color: "#8a8a8a", fontSize: 15 },
  slow: { alignItems: "center", gap: 6 },
  small: { color: "#8a8a8a", fontSize: 13 },
  link: { color: "#f5f5f5", textDecorationLine: "underline" },
});
