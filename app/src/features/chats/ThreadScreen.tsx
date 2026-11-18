/*
 * One conversation: the messages, newest at the bottom, and the composer.
 *
 * <ThreadScreen /> — drawn for a "thread" frame; reads { id } from the frame. Scrolling up to the
 *   top loads the page before; the top of the list always says what it is doing (loading, more
 *   above, or the beginning). The header's info button pushes the conversation's info frame.
 *
 * Example: open(self, "thread", { id: 5 })
 *
 * The soft keyboard moves the conversation in exactly one of two ways. Scrolled to the newest
 * message, the messages rise with the composer, frame for frame, with nothing shifting between
 * them; scrolled anywhere else, they do not move at all and the keyboard's height is added as room
 * to scroll into. The composer sits directly on the keyboard: the bottom safe area it stood on
 * while the keyboard was closed is under the keyboard now, so both lift by the keyboard's height
 * less that inset. The send button is stretched to the field's height rather than given the same
 * number, so the two agree on screen whatever the field's padding comes to.
 *
 * The list is shown once its first page is laid out: until every row is measured it may still
 * re-anchor at the bottom, and that settling is not something a reader should watch.
 *
 * A message on its way is drawn at once, faded, with "sending…" under it; one that has failed several
 * times says why and offers retry and remove, and removing puts its text back in the composer.
 *
 * Bubbles are WeChat's: own on the right in green, others on the left in grey with their face
 * beside, a name above in groups, a time between messages more than five minutes apart, at most
 * 72% of the reading column.
 */
import { MaterialIcons } from "@expo/vector-icons";
import { FlashList } from "@shopify/flash-list";
import { forwardRef, useRef, useState } from "react";
import { HostInstance, Pressable, ScrollViewProps, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { KeyboardChatScrollView, KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Message, Pending, useThread, useThreadInfo } from "../../data/chats";
import { isStuck } from "../../data/outbox";
import { useSession } from "../../data/session";
import { useFrame, useNav } from "../../nav/NavProvider";
import { useKeyboardSlide } from "../../platform/keyboardSlide";
import { Avatar } from "../../ui/Avatar";
import { Button, Header, Txt } from "../../ui/kit";
import { colors, fonts, metrics } from "../../ui/theme";
import { needsSeparator, separatorTime } from "./time";

const ChatScroll = forwardRef<never, ScrollViewProps>(function ChatScroll(props, ref) {
  const { bottom } = useSafeAreaInsets();
  return <KeyboardChatScrollView ref={ref} {...props} keyboardLiftBehavior="whenAtEnd" offset={bottom} />;
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

function PendingRow({ pending, onRetry, onRemove }: { pending: Pending; onRetry: () => void; onRemove: () => void }) {
  const stuck = isStuck(pending);
  return (
    <View testID="pending-message" style={[styles.row, styles.rowMine]}>
      <View style={styles.faceSpace} />
      <View style={[styles.column, { alignItems: "flex-end" }]}>
        <Bubble text={pending.content} mine faded={!stuck} />
        {stuck ? (
          <View style={styles.stuck}>
            <Txt variant="label" style={{ color: colors.danger }}>
              {pending.lastError ? `not sent: ${pending.lastError}` : "not sent"}
            </Txt>
            <Pressable testID="retry" onPress={onRetry}>
              <Txt variant="label" style={styles.action}>
                retry
              </Txt>
            </Pressable>
            <Pressable testID="remove" onPress={onRemove}>
              <Txt variant="label" style={styles.action}>
                remove
              </Txt>
            </Pressable>
          </View>
        ) : (
          <Txt variant="label" muted>
            sending…
          </Txt>
        )}
      </View>
    </View>
  );
}

export function ThreadScreen() {
  const self = useFrame();
  const id = self.params.id as number;
  const { backFor, push } = useNav();
  const { user } = useSession();
  const thread = useThread(id);
  const info = useThreadInfo(id);
  const [draft, setDraft] = useState("");
  // The composer is one line tall and grows with what is typed, up to 40% of the window (never
  // less than six lines' worth). Its height comes from an invisible copy of the text set exactly
  // like it: a text area's own scroll height only ever grows, so measuring it kept the box tall
  // after the text was gone.
  const { height: windowHeight } = useWindowDimensions();
  const [textHeight, setTextHeight] = useState(LINE);
  const inputHeight = Math.min(Math.max(140, windowHeight * 0.4), Math.max(metrics.composerHeight, textHeight + 2 * PAD_V + 2));
  const [laidOut, setLaidOut] = useState(false);
  // On the web the keyboard resizes the page at once; these glide instead (a phone follows its
  // keyboard frame by frame already). At the bottom the messages ride with the composer; scrolled
  // up, only the composer moves and the messages stay where they are.
  const listArea = useRef<HostInstance>(null);
  const composerArea = useRef<HostInstance>(null);
  const atBottom = useRef(true);
  useKeyboardSlide(() => (atBottom.current ? [listArea.current, composerArea.current] : [composerArea.current]));
  const { bottom } = useSafeAreaInsets();
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
      <Header
        title={title}
        onBack={backFor(self)}
        actions={
          <Pressable testID="chat-info" accessibilityLabel="chat info" hitSlop={10} onPress={() => push("threadInfo", "detail", { id, threadKey: self.key })}>
            <MaterialIcons name="info-outline" size={22} color={colors.ink} />
          </Pressable>
        }
      />
      {thread.loaded && (
        <View ref={listArea} style={styles.fill}>
          <FlashList
            onScroll={({ nativeEvent: e }) => {
              atBottom.current = e.contentOffset.y + e.layoutMeasurement.height >= e.contentSize.height - 24;
            }}
            style={!laidOut && thread.messages.length > 0 && styles.hidden}
            // Shown two frames after the first layout, not on it: the list measures its rows and
            // settles its position from the bottom in those frames, and that settling is the flash.
            onLoad={() => requestAnimationFrame(() => requestAnimationFrame(() => setLaidOut(true)))}
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
                  <PendingRow
                    key={p.clientToken}
                    pending={p}
                    onRetry={() => thread.retry(p.clientToken)}
                    onRemove={() => setDraft(thread.discard(p.clientToken) ?? "")}
                  />
                ))}
                {thread.error ? <Txt style={styles.error}>{String(thread.error)}</Txt> : null}
              </>
            }
            renderItem={({ item, index }) => (
              <Row item={item} prev={thread.messages[index - 1]} me={user?.id} members={members} group={members.length > 2} />
            )}
          />
        </View>
      )}
      {!thread.loaded && <View style={styles.fill} />}
      <KeyboardStickyView offset={{ closed: 0, opened: bottom }}>
        <View ref={composerArea} style={styles.composer}>
          <View style={styles.composerColumn}>
            <View style={styles.inputBox}>
              <Text style={styles.measure} pointerEvents="none" importantForAccessibility="no-hide-descendants" onLayout={(e) => setTextHeight(e.nativeEvent.layout.height)}>
                {`${draft}\u200b`}
              </Text>
            <TextInput
              testID="composer"
              accessibilityLabel="message"
              style={[styles.input, { height: inputHeight }]}
              value={draft}
              onChangeText={setDraft}
              placeholder="message…"
              placeholderTextColor={colors.inkMuted}
              multiline
            />
            </View>
            <Button kind="send" testID="send" label="send" onPress={send} disabled={!draft.trim()} style={styles.send} />
          </View>
        </View>
      </KeyboardStickyView>
    </View>
  );
}

const LINE = 20;
const PAD_V = 9;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.page },
  hidden: { opacity: 0 },
  fill: { flex: 1 },
  edge: { textAlign: "center", paddingVertical: 16 },
  separator: { textAlign: "center", paddingVertical: 8 },
  // One centred reading column, as the previous clients had: in a wide window the faces sit in
  // from the edges and a bubble's 72% is of the column, never a 1200 px line.
  row: { flexDirection: "row", paddingHorizontal: 10, paddingVertical: 3, gap: 8, width: "100%", maxWidth: metrics.readingColumn, alignSelf: "center" },
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
  stuck: { flexDirection: "row", gap: 8, marginTop: 2 },
  action: { color: colors.danger, textDecorationLine: "underline" },
  composer: {
    padding: 12,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  composerColumn: { flexDirection: "row", alignItems: "stretch", gap: 8, width: "100%", maxWidth: metrics.readingColumn, alignSelf: "center" },
  inputBox: { flex: 1 },
  // The invisible copy the composer's height is read from: the same face, size, line and inner
  // width as the input, laid out but never seen.
  measure: {
    position: "absolute",
    left: 1,
    right: 1,
    paddingHorizontal: 12,
    fontSize: 14,
    lineHeight: LINE,
    fontFamily: fonts.mono,
    opacity: 0,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: PAD_V,
    fontSize: 14,
    lineHeight: LINE,
    fontFamily: fonts.mono,
    color: colors.ink,
  },
  send: { paddingVertical: 0 },
});
