/*
 * The chat list: every conversation, most recent first, the next page loaded as the end comes
 * into view.
 *
 * <ChatsScreen /> — the "chats" section's root frame. A row opens its conversation with open(),
 *   so it lands beside the list in a wide window and on top of it on a phone. "new" asks for a
 *   title, makes the conversation and opens it; if the server refuses, its message is shown.
 *
 * Example: routes={{ chats: ChatsScreen, ... }}
 *
 * The row is WeChat's: the other person's face in a one-to-one, a grid of faces in a group (or the
 * one agent's face in a group with exactly one agent), title and time on one line, the last
 * message under it clipped rather than ellipsised. Rows are roomier when the list fills a phone
 * than when it is the narrow column beside a conversation.
 */
import { FlashList } from "@shopify/flash-list";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { chatTitle, ChatSummary, useChats, useCreateChat } from "../../data/chats";
import { useSession } from "../../data/session";
import { useFrame, useNav } from "../../nav/NavProvider";
import { Avatar, MemberGrid } from "../../ui/Avatar";
import { DialogActions, useAsk } from "../../ui/Dialog";
import { Button, Field, Header, Pressy, Txt } from "../../ui/kit";
import { colors, metrics } from "../../ui/theme";
import { listTime } from "./time";

function NewChatForm({ done }: { done: (title: string) => void }) {
  const [title, setTitle] = useState("");
  return (
    <>
      <Field testID="new-chat-title" value={title} onChangeText={setTitle} placeholder="title" autoFocus onSubmitEditing={() => done(title)} />
      <DialogActions>
        <Button kind="text" testID="new-chat-create" label="create" onPress={() => done(title)} disabled={!title.trim()} />
      </DialogActions>
    </>
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
  const [width, setWidth] = useState(0);
  const [refused, setRefused] = useState<string | null>(null);
  const dense = width > 0 && width < metrics.readingColumn;

  const newChat = async () => {
    const title = await ask<string>("new chat", (done) => <NewChatForm done={done} />);
    if (!title?.trim()) return;
    try {
      setRefused(null);
      const id = await create(title.trim());
      open(self, "thread", { id });
    } catch (e) {
      setRefused(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <View style={styles.root} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <Header title="chats" actions={<Button kind="text" testID="new-chat" label="new" onPress={newChat} />} />
      {error ? <Txt style={styles.notice}>{String(error)}</Txt> : null}
      {refused ? <Txt testID="error" style={styles.notice}>{`could not start the chat: ${refused}`}</Txt> : null}
      <FlashList
        data={chats}
        keyExtractor={(c) => String(c.id)}
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
});
