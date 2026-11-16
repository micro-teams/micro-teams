/*
 * The docs section's root: the current team's documents as a tree.
 *
 * <DocsScreen /> — the root frame of a "docs" stack; its { team } is the team the stack belongs
 *   to, so switching teams shows another stack and coming back finds this one as it was. A file
 *   opens with open(), beside the tree in a wide window. A folder folds and unfolds. Every row's
 *   "⋯" drops a menu: new file or folder inside it, and for anything but the root, rename and
 *   move, then delete, the groups divided. A new folder is made with a README.md in it, because git keeps no empty
 *   folders.
 *
 * Example: routes={{ docs: DocsScreen, ... }}
 */
import { MaterialIcons } from "@expo/vector-icons";
import { FlashList } from "@shopify/flash-list";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { childPath, DocNode, flatten, nameOf, parentOf, useDocEdits, useDocTree } from "../../data/docs";
import { useTeams } from "../../data/teams";
import { useFrame, useNav } from "../../nav/NavProvider";
import { useAsk } from "../../ui/Dialog";
import { MenuButton, type MenuItem } from "../../ui/Menu";
import { Header, Pressy, Txt } from "../../ui/kit";
import { Confirm, TextPrompt } from "../../ui/prompts";
import { colors } from "../../ui/theme";
import { useToast } from "../../ui/Toast";
import { TeamPicker, useTeamScope } from "../agents/TeamPicker";

type Action = "file" | "folder" | "rename" | "move" | "delete";

/** The row menu, grouped as the previous client did: making, then renaming and moving, then deleting. */
function menuItems(isRoot: boolean): MenuItem<Action>[] {
  const make: MenuItem<Action>[] = [
    { value: "file", label: "new file", testID: "doc-action-file" },
    { value: "folder", label: "new folder", testID: "doc-action-folder" },
  ];
  if (isRoot) return make;
  return [
    ...make,
    "divider",
    { value: "rename", label: "rename", testID: "doc-action-rename" },
    { value: "move", label: "move", testID: "doc-action-move" },
    "divider",
    { value: "delete", label: "delete", danger: true, testID: "doc-action-delete" },
  ];
}

function Row({
  label,
  icon,
  depth,
  testID,
  onPress,
  menu,
  onAction,
}: {
  label: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  depth: number;
  testID: string;
  onPress: () => void;
  menu: MenuItem<Action>[];
  onAction: (a: Action) => void;
}) {
  return (
    <Pressy testID={testID} onPress={onPress} style={[styles.row, { paddingLeft: 12 + depth * 16 }]}>
      <MaterialIcons name={icon} size={18} color={colors.inkMuted} />
      <Txt numberOfLines={1} style={styles.label}>
        {label}
      </Txt>
      <MenuButton testID={`${testID}-menu`} accessibilityLabel="actions" items={menu} onSelected={onAction} style={styles.menu}>
        <MaterialIcons name="more-horiz" size={16} color={colors.inkMuted} />
      </MenuButton>
    </Pressy>
  );
}

export function DocsScreen() {
  const self = useFrame();
  const team = (self.params.team as number | null) ?? null;
  const scoped = useTeamScope();
  const { open } = useNav();
  const { teams } = useTeams();
  const tree = useDocTree(team);
  const edits = useDocEdits(team);
  const ask = useAsk();
  const toast = useToast();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([""]));
  const toggle = (path: string) =>
    setExpanded((e) => {
      const next = new Set(e);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  const guard = async (action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };

  const create = async (folder: boolean, within: string) => {
    const name = await ask<string>(folder ? "new folder" : "new file", (done) => (
      <TextPrompt testID="doc-name" placeholder={folder ? "notes" : "idea.md"} action="create" done={done} />
    ));
    if (!name?.trim()) return;
    const path = childPath(within, name.trim());
    const target = folder ? `${path}/README.md` : path;
    await guard(async () => {
      await edits.write(target, `# ${nameOf(folder ? path : target)}\n`);
      setExpanded((e) => new Set([...e, within, ...(folder ? [path] : [])]));
      if (!folder) open(self, "doc", { team, path: target });
    });
  };

  const act = async (node: DocNode | null, action: Action) => {
    const within = !node ? "" : node.isFolder ? node.path : parentOf(node.path);
    if (action === "file" || action === "folder") return create(action === "folder", within);
    if (!node) return;
    if (action === "rename" || action === "move") {
      const renaming = action === "rename";
      const answer = await ask<string>(`${action} ${nameOf(node.path)}`, (done) => (
        <TextPrompt testID="doc-name" initial={renaming ? nameOf(node.path) : node.path} action={action} done={done} />
      ));
      const to = renaming && answer ? childPath(parentOf(node.path), answer.trim()) : answer?.trim();
      if (to && to !== node.path) await guard(() => edits.move(node.path, to));
      return;
    }
    const ok = await ask<boolean>(`delete ${nameOf(node.path)}?`, (done) => (
      <Confirm
        text={node.isFolder ? "Everything in it goes too. It stays in the repository history." : "It stays in the repository history."}
        action="delete"
        done={done}
      />
    ));
    if (ok) await guard(() => edits.remove(node.path));
  };

  const rows = flatten(tree.root, expanded);
  const teamName = teams.find((t) => t.id === team)?.name ?? "docs";

  return (
    <View style={styles.root}>
      <Header title="docs" actions={<TeamPicker />} />
      {scoped === null ? (
        <Txt muted style={styles.notice}>
          you are not in any team yet
        </Txt>
      ) : tree.error ? (
        <Txt style={styles.notice}>{String(tree.error)}</Txt>
      ) : !tree.loaded ? (
        <Txt muted style={styles.notice}>
          loading…
        </Txt>
      ) : (
        <FlashList
          data={rows}
          keyExtractor={(r) => r.node.path}
          ListHeaderComponent={
            <Row
              testID="doc-root"
              label={teamName}
              icon={expanded.has("") ? "folder-open" : "folder"}
              depth={0}
              onPress={() => toggle("")}
              menu={menuItems(true)}
              onAction={(a) => act(null, a)}
            />
          }
          renderItem={({ item: { node, depth } }) => (
            <Row
              testID={`doc-${node.path}`}
              label={nameOf(node.path)}
              icon={node.isFolder ? (expanded.has(node.path) ? "folder-open" : "folder") : "description"}
              depth={depth + 1}
              onPress={() => (node.isFolder ? toggle(node.path) : open(self, "doc", { team, path: node.path }))}
              menu={menuItems(false)}
              onAction={(a) => act(node, a)}
            />
          )}
          ListEmptyComponent={
            expanded.has("") ? (
              <Txt muted style={styles.notice}>
                no documents yet — “⋯” on the team makes one
              </Txt>
            ) : null
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.page },
  row: { flexDirection: "row", alignItems: "center", paddingRight: 8, height: 36, gap: 8 },
  label: { flex: 1 },
  menu: { width: 24, height: 24, alignItems: "center", justifyContent: "center" },
  notice: { textAlign: "center", padding: 24 },
});
