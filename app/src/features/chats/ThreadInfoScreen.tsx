/*
 * A conversation's members and settings: drawn for a "threadInfo" frame with { id, threadKey }.
 *
 * <ThreadInfoScreen /> — the title, everybody in the conversation as a grid of faces (owners
 *   first), and what the caller may do: an owner or admin adds people by id, removes anybody but
 *   an owner and themselves, and renames; an owner deletes the conversation, which closes this
 *   frame and the conversation under it (popTo threadKey) rather than jumping anywhere.
 *
 * Example: push("threadInfo", "detail", { id: 5, threadKey: self.key })
 *
 * A grid rather than a list because a roster is scanned, not read. Every action that changes
 * something asks first, and a refusal from the server is shown, never swallowed.
 */
import { MaterialIcons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useThreadInfo } from "../../data/chats";
import { useSession } from "../../data/session";
import { useFrame, useNav } from "../../nav/NavProvider";
import { Avatar } from "../../ui/Avatar";
import { DialogActions, useAsk } from "../../ui/Dialog";
import { Button, Field, Header, Txt } from "../../ui/kit";
import { colors } from "../../ui/theme";
import { useToast } from "../../ui/Toast";

function TextForm({ initial, action, done, testID, numeric }: { initial: string; action: string; done: (v: string) => void; testID: string; numeric?: boolean }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <Field testID={testID} value={value} onChangeText={setValue} autoFocus keyboardType={numeric ? "number-pad" : "default"} onSubmitEditing={() => done(value)} />
      <DialogActions>
        <Button kind="text" testID={`${testID}-ok`} label={action} onPress={() => done(value)} disabled={!value.trim()} />
      </DialogActions>
    </>
  );
}

function Confirm({ text, action, done }: { text: string; action: string; done: (ok: boolean) => void }) {
  return (
    <>
      <Txt muted>{text}</Txt>
      <DialogActions>
        <Button kind="text" label="cancel" onPress={() => done(false)} />
        <Button kind="text" testID="confirm" label={action} onPress={() => done(true)} />
      </DialogActions>
    </>
  );
}

export function ThreadInfoScreen() {
  const self = useFrame();
  const { id, threadKey } = self.params as { id: number; threadKey: string };
  const { backFor, popTo } = useNav();
  const { user } = useSession();
  const info = useThreadInfo(id);
  const ask = useAsk();
  const toast = useToast();
  const myRole = info.roleOf(user?.id);
  const canManage = myRole === "OWNER" || myRole === "ADMIN";

  const guard = async (action: () => Promise<void>) => {
    try {
      await action();
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
      return false;
    }
  };

  const add = async () => {
    const raw = await ask<string>("add someone", (done) => <TextForm testID="add-member" initial="" action="add" numeric done={done} />);
    const userId = Number((raw ?? "").trim());
    if (raw && Number.isInteger(userId) && userId > 0) await guard(() => info.add(userId));
  };

  const rename = async () => {
    const title = await ask<string>("rename chat", (done) => <TextForm testID="rename" initial={info.storedTitle} action="rename" done={done} />);
    if (title?.trim()) await guard(() => info.rename(title.trim()));
  };

  const remove = async (userId: number, name: string) => {
    const ok = await ask<boolean>(`remove ${name}?`, (done) => (
      <Confirm text="They stop seeing this conversation. Someone can add them back." action="remove" done={done} />
    ));
    if (ok) await guard(() => info.remove(userId));
  };

  const dissolve = async () => {
    const ok = await ask<boolean>("delete this chat?", (done) => (
      <Confirm text="It goes for everyone in it, along with every message." action="delete" done={done} />
    ));
    if (ok && (await guard(() => info.dissolve()))) popTo(threadKey);
  };

  return (
    <View style={styles.root}>
      <Header title="chat info" onBack={backFor(self)} />
      <ScrollView contentContainerStyle={styles.body}>
        <Txt variant="title">{info.storedTitle || "untitled"}</Txt>
        <View style={styles.grid}>
          {info.members.map((m) => {
            const name = m.nickname?.trim() || `user ${m.userId}`;
            const removable = canManage && m.role !== "OWNER" && m.userId !== user?.id;
            return (
              <View key={m.userId} style={styles.member} testID={`member-${m.userId}`}>
                <View>
                  <Avatar userId={m.userId} nickname={m.nickname} avatarId={m.avatarId} size={56} />
                  {removable && (
                    <Pressable testID={`remove-${m.userId}`} accessibilityLabel={`remove ${name}`} onPress={() => remove(m.userId, name)} style={styles.remove} hitSlop={6}>
                      <MaterialIcons name="close" size={12} color="#fff" />
                    </Pressable>
                  )}
                </View>
                <Txt variant="small" numberOfLines={1} style={styles.name}>
                  {name}
                </Txt>
              </View>
            );
          })}
          {canManage && (
            <Pressable testID="add-member" onPress={add} style={styles.member}>
              <View style={styles.addTile}>
                <MaterialIcons name="add" size={28} color={colors.inkMuted} />
              </View>
              <Txt variant="small" muted style={styles.name}>
                add
              </Txt>
            </Pressable>
          )}
        </View>
        {canManage && <Button kind="text" testID="rename-chat" label="rename chat" onPress={rename} style={styles.left} />}
        {myRole === "OWNER" && (
          <Pressable testID="delete-chat" onPress={dissolve} style={styles.left}>
            <Txt style={{ color: colors.danger }}>delete this chat</Txt>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.page },
  body: { padding: 16, gap: 16 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 16 },
  member: { width: 64, alignItems: "center" },
  name: { marginTop: 4, textAlign: "center" },
  remove: {
    position: "absolute",
    right: -6,
    top: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.danger,
    alignItems: "center",
    justifyContent: "center",
  },
  addTile: {
    width: 56,
    height: 56,
    borderRadius: 6,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
  },
  left: { alignSelf: "flex-start" },
});
