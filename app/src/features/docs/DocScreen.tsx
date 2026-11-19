/*
 * One document: read as what it is (DocView: markdown, a diagram, a table, an SVG, code), or edited
 * as text and saved as a commit.
 *
 * <DocScreen /> — drawn for a "doc" frame with { team, path }. The header has the history (pushes
 *   "docHistory") and edit, or cancel and save while editing. A link to another document of the
 *   team opens it on top of this one; a web address opens outside the app. When the file is not
 *   there any more, it says so and offers to close the frame.
 *
 * Example: open(self, "doc", { team: 3, path: "notes/plan.md" })
 */
import { MaterialIcons } from "@expo/vector-icons";
import { useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { nameOf, resolveDocLink, useDoc, useDocEdits } from "../../data/docs";
import { useFrame, useNav } from "../../nav/NavProvider";
import { Button, Header, Txt } from "../../ui/kit";
import { colors, fonts, metrics } from "../../ui/theme";
import { useToast } from "../../ui/Toast";
import { DocView, kindOf } from "./DocView";

export function DocScreen() {
  const self = useFrame();
  const { team, path } = self.params as { team: number | null; path: string };
  const { backFor, push, popTo } = useNav();
  const doc = useDoc(team, path);
  const edits = useDocEdits(team);
  const toast = useToast();
  const [draft, setDraft] = useState<string | null>(null);
  // Text is edited as text; a binary file, which the API can only hand over mangled, is not.
  const binary = doc.loaded && kindOf(path, doc.content) === "binary";
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (draft === null) return;
    setSaving(true);
    try {
      await edits.write(path, draft);
      setDraft(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const follow = (href: string) => {
    const inTree = resolveDocLink(path, href);
    if (inTree) push("doc", "detail", { team, path: inTree });
    else if (/^https?:/i.test(href)) void Linking.openURL(href);
    else toast(`cannot open ${href}`);
  };

  const actions = (
    <View style={styles.actions}>
      <Pressable testID="doc-history" accessibilityLabel="history" hitSlop={8} onPress={() => push("docHistory", "detail", { team, path })}>
        <MaterialIcons name="history" size={22} color={colors.ink} />
      </Pressable>
      {draft !== null ? (
        <>
          <Button kind="text" label="cancel" onPress={() => setDraft(null)} />
          <Button kind="text" testID="doc-save" label={saving ? "saving…" : "save"} onPress={save} disabled={saving} />
        </>
      ) : (
        <Pressable testID="doc-edit" accessibilityLabel="edit" hitSlop={8} disabled={!doc.loaded || binary} onPress={() => setDraft(doc.content)}>
          <MaterialIcons name="edit" size={20} color={doc.loaded && !binary ? colors.ink : colors.inkMuted} />
        </Pressable>
      )}
    </View>
  );

  return (
    <View style={styles.root}>
      <Header title={nameOf(path)} onBack={backFor(self)} actions={doc.gone ? undefined : actions} />
      {doc.gone ? (
        <View style={styles.center}>
          <Txt>{`${path} is not in the tree any more`}</Txt>
          <Txt variant="small" muted style={styles.gap}>
            It was deleted or renamed. Its history is still in the repository.
          </Txt>
          <Button kind="text" label="close" onPress={() => popTo(self.key)} />
        </View>
      ) : doc.error ? (
        <Txt style={styles.notice}>{String(doc.error)}</Txt>
      ) : !doc.loaded ? (
        <Txt muted style={styles.notice}>
          loading…
        </Txt>
      ) : draft !== null ? (
        <TextInput
          testID="doc-editor"
          value={draft}
          onChangeText={setDraft}
          multiline
          autoFocus
          textAlignVertical="top"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.editor}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.body} testID="doc-view">
          <View style={styles.column}>
            <DocView path={path} content={doc.content} onLink={follow} />
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.page },
  actions: { flexDirection: "row", alignItems: "center", gap: 12 },
  body: { padding: 16, paddingBottom: 32, alignItems: "center" },
  column: { width: "100%", maxWidth: metrics.readingColumn },
  editor: {
    flex: 1,
    padding: 12,
    color: colors.ink,
    fontFamily: fonts.mono,
    fontSize: 13,
    lineHeight: 20,
    alignSelf: "center",
    width: "100%",
    maxWidth: metrics.readingColumn,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 8 },
  gap: { textAlign: "center" },
  notice: { textAlign: "center", padding: 24 },
});
