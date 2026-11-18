/*
 * The chat list: every conversation, most recent first, the next page loaded as the end comes
 * into view.
 *
 * <ChatsScreen /> — the "chats" section's root frame. A row opens its conversation with open(),
 *   so it lands beside the list in a wide window and on top of it on a phone. "new" asks for a
 *   title and optional member ids, makes the conversation and opens it; a refusal is shown in the
 *   dialog, which stays open.
 *
 * Example: routes={{ chats: ChatsScreen, ... }}
 *
 * The row is WeChat's: the other person's face in a one-to-one, a grid of faces in a group (or the
 * one agent's face in a group with exactly one agent), title and time on one line, the last
 * message under it clipped rather than ellipsised. Rows are roomier when the list fills a phone
 * than when it is the narrow column beside a conversation.
 */
import { MaterialIcons } from "@expo/vector-icons";
import { FlashList } from "@shopify/flash-list";
import { useState } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { chatTitle, ChatSummary, parseMemberIds, useChats, useCreateChat } from "../../data/chats";
import { useSession } from "../../data/session";
import { useFrame, useNav } from "../../nav/NavProvider";
import { Avatar, MemberGrid } from "../../ui/Avatar";
import { DialogActions, useAsk } from "../../ui/Dialog";
import { Button, Field, Header, Pressy, Txt } from "../../ui/kit";
import { colors, metrics, WIDE } from "../../ui/theme";
import { listTime } from "./time";

/**
 * "New chat": a title, and optionally who else is in it, by user id — there is no user search, and
 * more people can be added from the chat's info page. The dialog makes the chat itself, so a
 * refusal is shown where it was asked for and the form stays filled; it answers with the new id.
 */
function NewChatForm({ create, done }: { create: (title: string, members: number[]) => Promise<number>; done: (id: number) => void }) {
  const [title, setTitle] = useState("");
  const [members, setMembers] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!title.trim()) return setError("give it a title");
    setBusy(true);
    setError(null);
    try {
      done(await create(title.trim(), parseMemberIds(members)));
    } catch (e) {
      setError(`could not start the chat: ${e instanceof Error ? e.message : String(e)}`);
      setBusy(false);
    }
  };
  return (
    <View style={styles.form}>
      <Field testID="new-chat-title" value={title} onChangeText={setTitle} placeholder="title — general" autoFocus onSubmitEditing={submit} />
      <Field testID="new-chat-members" value={members} onChangeText={setMembers} placeholder="member ids (optional) — 12, 34, 56" keyboardType="numbers-and-punctuation" />
      {error ? (
        <Txt testID="error" style={{ color: colors.danger }}>
          {error}
        </Txt>
      ) : null}
      <DialogActions>
        <Button kind="text" testID="new-chat-create" label="create" busy={busy} onPress={submit} />
      </DialogActions>
    </View>
  );
}

function Row({ chat, me, dense, onPress }: { chat: ChatSummary; me?: number; dense: boolean; onPress: () => void }) {
  const others = chat.members.filter((m) => m.userId !== me);
  const oneOnOne = chat.members.length === 2 && others.length === 1;
  const agents = chat.members.filter((m) => m.isAgent === true);
  const face = oneOnOne ? others[0] : agents.length === 1 ? agents[0] : null;
  const size = dense ? metrics.avatarInDenseList : metrics.avatarInList;
  const last = chat.lastMessage;
  const sender = chat.members.find((m) => m.userId === last?.senderId)?.nickname;
  const preview = !last ? "tap to open" : oneOnOne ? last.content : `${sender ?? ""}：${last.content}`;
  return (
    <Pressy testID={`chat-${chat.id}`} onPress={onPress} style={styles.row}>
      {face ? <Avatar userId={face.userId} nickname={face.nickname} avatarId={face.avatarId} size={size} /> : <MemberGrid members={chat.members} size={size} />}
      <View style={styles.text}>
        <View style={styles.titleLine}>
          <Txt numberOfLines={1} style={[styles.title, { fontSize: dense ? metrics.rowTitleDense : metrics.rowTitlePhone }]}>
            {chatTitle(chat, me)}
          </Txt>
          <Txt variant="label" muted>
            {listTime(last?.createdAt ?? chat.updatedAt)}
          </Txt>
        </View>
        <Txt testID={`chat-${chat.id}-last`} numberOfLines={1} muted style={styles.preview}>
          {preview.replace(/\s+/g, " ")}
        </Txt>
      </View>
    </Pressy>
  );
}

export function ChatsScreen() {
  const self = useFrame();
  const { open } = useNav();
  const { user } = useSession();
  const { chats, loadMore, loading, error } = useChats();
  const create = useCreateChat();
  const ask = useAsk();
  // The list's own width, guessed from the window before the first layout. A hidden stack lays out
  // at zero width; taking that as the width drew the rows roomy for a frame on coming back, then
  // dense — the list visibly shrank. A zero width is not news and is ignored.
  const window = useWindowDimensions();
  const [width, setWidth] = useState(() => (window.width >= WIDE ? metrics.listPane : window.width));
  const dense = width < metrics.readingColumn;

  const newChat = async () => {
    const id = await ask<number>("new chat", (done) => <NewChatForm create={create} done={done} />);
    if (id !== null) open(self, "thread", { id });
  };

  return (
    <View style={styles.root} onLayout={(e) => e.nativeEvent.layout.width > 0 && setWidth(e.nativeEvent.layout.width)}>
      <Header
        title="chats"
        actions={
          <Pressable testID="new-chat" accessibilityLabel="new chat" hitSlop={10} onPress={newChat}>
            <MaterialIcons name="add-comment" size={22} color={colors.ink} />
          </Pressable>
        }
      />
      {error ? <Txt style={styles.notice}>{String(error)}</Txt> : null}
      <FlashList
        data={chats}
        keyExtractor={(c) => String(c.id)}
        // Off, unlike a conversation's list. Kept on, it held the first visible row still when a
        // conversation with a new message moved to the top, so the conversation that just spoke
        // landed above the top of the screen; a chat list shows its newest at the top, as WeChat's does.
        maintainVisibleContentPosition={{ disabled: true }}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        renderItem={({ item }) => <Row chat={item} me={user?.id} dense={dense} onPress={() => open(self, "thread", { id: item.id })} />}
        ListEmptyComponent={<Txt muted style={styles.notice}>{loading ? "loading…" : "no conversations yet"}</Txt>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.page },
  row: { flexDirection: "row", paddingHorizontal: 12, paddingVertical: 8 },
  text: { flex: 1, marginLeft: 12 },
  titleLine: { flexDirection: "row", alignItems: "baseline" },
  title: { flex: 1, fontWeight: "500", marginRight: 8 },
  preview: { marginTop: 2 },
  notice: { textAlign: "center", padding: 24 },
  form: { gap: 12 },
});
