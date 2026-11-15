/*
 * A document's history, and what one commit changed in it.
 *
 * <DocHistoryScreen /> — drawn for a "docHistory" frame with { team, path }: the commits that
 *   touched the file, newest first; one opens its diff ("docDiff") on top.
 * <DocDiffScreen /> — drawn for a "docDiff" frame with { team, path, sha, message }: the unified
 *   diff, added lines green, removed lines red, hunk headers muted, scrolling sideways rather than
 *   wrapping so columns stay where they were.
 *
 * Example: push("docHistory", "detail", { team: 3, path: "notes/plan.md" })
 */
import { FlashList } from "@shopify/flash-list";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { nameOf, useDocDiff, useDocHistory } from "../../data/docs";
import { useFrame, useNav } from "../../nav/NavProvider";
import { Header, Pressy, Txt } from "../../ui/kit";
import { colors, fonts } from "../../ui/theme";
import { listTime } from "../chats/time";

export function DocHistoryScreen() {
  const self = useFrame();
  const { team, path } = self.params as { team: number | null; path: string };
  const { backFor, push } = useNav();
  const history = useDocHistory(team, path);
  return (
    <View style={styles.root}>
      <Header title={`history · ${nameOf(path)}`} onBack={backFor(self)} />
      {history.error ? (
        <Txt style={styles.notice}>{String(history.error)}</Txt>
      ) : (
        <FlashList
          data={history.commits}
          keyExtractor={(c) => c.sha}
          renderItem={({ item: c }) => (
            <Pressy testID={`commit-${c.sha.slice(0, 7)}`} style={styles.row} onPress={() => push("docDiff", "detail", { team, path, sha: c.sha, message: c.message })}>
              <Txt numberOfLines={2}>{c.message.trim() || "(no message)"}</Txt>
              <Txt variant="small" muted>
                {`${c.sha.slice(0, 7)} · ${c.author} · ${listTime(new Date(c.timestamp * 1000).toISOString())}`}
              </Txt>
            </Pressy>
          )}
          ListEmptyComponent={
            <Txt muted style={styles.notice}>
              {history.loaded ? "no history" : "loading…"}
            </Txt>
          }
        />
      )}
    </View>
  );
}

function lineColor(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---")) return colors.inkMuted;
  if (line.startsWith("+")) return colors.brand;
  if (line.startsWith("-")) return colors.danger;
  if (line.startsWith("@@")) return colors.inkMuted;
  return colors.ink;
}

export function DocDiffScreen() {
  const self = useFrame();
  const { team, path, sha, message } = self.params as { team: number | null; path: string; sha: string; message: string };
  const { backFor } = useNav();
  const d = useDocDiff(team, path, sha);
  return (
    <View style={styles.root}>
      <Header title={`${sha.slice(0, 7)} · ${nameOf(path)}`} onBack={backFor(self)} />
      <ScrollView contentContainerStyle={styles.body}>
        <Txt style={styles.message}>{message.trim()}</Txt>
        {d.error ? (
          <Txt>{String(d.error)}</Txt>
        ) : !d.loaded ? (
          <Txt muted>loading…</Txt>
        ) : (
          <ScrollView horizontal>
            <Text selectable testID="diff">
              {d.diff.split("\n").map((line, i) => (
                <Text key={i} style={[styles.diff, { color: lineColor(line) }]}>
                  {`${line}\n`}
                </Text>
              ))}
            </Text>
          </ScrollView>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.page },
  row: { paddingHorizontal: 16, paddingVertical: 10, gap: 4 },
  body: { padding: 16, gap: 12 },
  message: { fontWeight: "600" },
  diff: { fontFamily: fonts.mono, fontSize: 12, lineHeight: 18 },
  notice: { textAlign: "center", padding: 24 },
});
