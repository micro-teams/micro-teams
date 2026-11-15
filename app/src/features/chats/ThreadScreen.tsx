/*
 * One conversation: the messages, newest at the bottom, and the composer.
 *
 * <ThreadScreen /> — drawn for a "thread" frame; reads { id } from the frame. Scrolling up to the
 *   top loads the page before; the top of the list always says what it is doing (loading, more
 *   above, or the beginning).
 *
 * Example: open(self, "thread", { id: 5 })
 *
 * The soft keyboard does not move the conversation. The composer rides up with the keyboard on its
 * own; the list keeps its height and is given the keyboard's height as extra room to scroll into,
 * so nothing on screen moves while the keyboard opens and the newest messages can still be dragged
 * up above it. The send button is stretched to the field's height rather than given the same number,
 * so the two agree on screen whatever the field's padding comes to.
 *
 * Bubbles are WeChat's: own on the right in green, others on the left in grey with their face
 * beside, a name above in groups, a time between messages more than five minutes apart, at most
 * 72% of the reading column.
 */
import { FlashList } from "@shopify/flash-list";
import { forwardRef, useState } from "react";
import { ScrollViewProps, StyleSheet, TextInput, View } from "react-native";
import { KeyboardChatScrollView, KeyboardStickyView } from "react-native-keyboard-controller";
import { Message, useThread, useThreadInfo } from "../../data/chats";
import { useSession } from "../../data/session";
import { useFrame, useNav } from "../../nav/NavProvider";
import { Avatar } from "../../ui/Avatar";
import { Button, Header, Txt } from "../../ui/kit";
import { colors, fonts, metrics } from "../../ui/theme";
import { needsSeparator, separatorTime } from "./time";

const ChatScroll = forwardRef<never, ScrollViewProps>(function ChatScroll(props, ref) {
  return <KeyboardChatScrollView ref={ref} {...props} keyboardLiftBehavior="never" />;
});

type Member = { userId: number; nickname?: string; avatarId?: number };

function Bubble({ text, mine, faded }: { text: string; mine: boolean; faded?: boolean }) {
  const bg = mine ? colors.ownBubble : colors.otherBubble;
  return (
    <View style={[styles.bubble, { backgroundColor: bg }, faded && { opacity: 0.6 }]}>
      <View style={[styles.tail, { backgroundColor: bg }, mine ? { right: -3 } : { left: -3 }]} />
      <Txt selectable style={{ color: mine ? colors.ownBubbleInk : colors.otherBubbleInk, fontSize: metrics.bubbleText, lineHeight: 19 }}>
        {text}
      </Txt>
    </View>
  );
}

function Row({ item, prev, me, members, group }: { item: Message; prev?: Message; me?: number; members: Member[]; group: boolean }) {
  const mine = item.senderId === me;
  const who = members.find((m) => m.userId === item.senderId);
  return (
    <View testID={`message-${item.id}`}>
      {needsSeparator(prev?.createdAt, item.createdAt) && (
        <Txt variant="label" muted style={styles.separator}>
          {separatorTime(item.createdAt)}
        </Txt>
      )}
      <View style={[styles.row, mine && styles.rowMine]}>
        <Avatar userId={item.senderId} nickname={who?.nickname} avatarId={who?.avatarId} />
        <View style={[styles.column, mine && { alignItems: "flex-end" }]}>
          {group && !mine && (
            <Txt variant="label" muted style={styles.name}>
              {who?.nickname ?? `#${item.senderId}`}
            </Txt>
          )}
          <Bubble text={item.content} mine={mine} />
        </View>
      </View>
    </View>
  );
}

export function ThreadScreen() {
  const self = useFrame();
  const id = self.params.id as number;
  const { backFor } = useNav();
  const { user } = useSession();
  const thread = useThread(id);
  const info = useThreadInfo(id);
  const [draft, setDraft] = useState("");
  const members: Member[] = info.members;
  const title = info.title(user?.id);

  const send = () => {
    thread.send(draft);
    setDraft("");
  };

  const edge = thread.loadingOlder
    ? "loading earlier messages"
    : thread.hasOlder
      ? "scroll up for earlier messages"
      : "the beginning of this conversation";

  return (
    <View style={styles.root}>
      <Header title={title} onBack={backFor(self)} />
      <FlashList
        data={thread.messages}
        keyExtractor={(m) => String(m.id)}
        renderScrollComponent={ChatScroll}
        maintainVisibleContentPosition={{ startRenderingFromBottom: true, autoscrollToBottomThreshold: 0.2 }}
        onStartReached={thread.loadOlder}
        onStartReachedThreshold={0.5}
        ListHeaderComponent={<Txt variant="small" muted style={styles.edge}>{edge}</Txt>}
        ListFooterComponent={
          <>
            {thread.pending.map((p) => (
              <View key={p.clientToken} testID="pending-message" style={[styles.row, styles.rowMine]}>
                <View style={styles.faceSpace} />
                <View style={[styles.column, { alignItems: "flex-end" }]}>
                  <Bubble text={p.content} mine faded />
                  <Txt variant="label" muted>
                    sending…
                  </Txt>
                </View>
              </View>
            ))}
            {thread.error ? <Txt style={styles.error}>{String(thread.error)}</Txt> : null}
          </>
        }
        renderItem={({ item, index }) => (
          <Row item={item} prev={thread.messages[index - 1]} me={user?.id} members={members} group={members.length > 2} />
        )}
      />
      <KeyboardStickyView>
        <View style={styles.composer}>
          <TextInput
            testID="composer"
            accessibilityLabel="message"
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="message…"
            placeholderTextColor={colors.inkMuted}
            multiline
          />
          <Button kind="send" testID="send" label="send" onPress={send} disabled={!draft.trim()} style={styles.send} />
        </View>
      </KeyboardStickyView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.page },
  edge: { textAlign: "center", paddingVertical: 16 },
  separator: { textAlign: "center", paddingVertical: 8 },
  row: { flexDirection: "row", paddingHorizontal: 10, paddingVertical: 3, gap: 8 },
  rowMine: { flexDirection: "row-reverse" },
  column: { flexShrink: 1, maxWidth: `${metrics.bubbleMaxFraction * 100}%` },
  name: { marginLeft: 4, marginBottom: 2 },
  faceSpace: { width: metrics.avatarInBubble, height: metrics.avatarInBubble },
  bubble: {
    borderRadius: metrics.bubbleRadius,
    paddingHorizontal: metrics.bubblePadH,
    paddingVertical: metrics.bubblePadV,
  },
  tail: { position: "absolute", top: 12, width: 8, height: 8, transform: [{ rotate: "45deg" }] },
  error: { color: colors.danger, textAlign: "center", padding: 8 },
  composer: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 8,
    padding: 12,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  input: {
    flex: 1,
    maxHeight: 140,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: fonts.mono,
    color: colors.ink,
  },
  send: { paddingVertical: 0 },
});
