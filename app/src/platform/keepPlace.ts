/*
 * Keeping what is being read where it is when content arrives above it, in a scroll view whose
 * first child is a status line and whose later children are messages, oldest first.
 *
 * useKeepPlace(scroller, first) → props to spread on the scroll view. scroller is the scroll view's
 *   ref; first is the key of its first message, which changes exactly when messages are put above
 *   the ones already there. On a phone the scroll view does the work itself, on the UI thread, in
 *   the frame the new rows are mounted: maintainVisibleContentPosition holds the first child from
 *   index 1 on that is in view where it was. Index 0, the status line, is left out, since it stays
 *   at the top whatever is put under it.
 *
 * Example: <ScrollView ref={list} {...useKeepPlace(list, messages[0]?.id)}>…</ScrollView>
 */
import type { RefObject } from "react";
import type { ScrollViewProps } from "react-native";
import type { KeyboardChatScrollViewRef } from "react-native-keyboard-controller";

export function useKeepPlace(_scroller: RefObject<KeyboardChatScrollViewRef | null>, _first: unknown): ScrollViewProps {
  return { maintainVisibleContentPosition: { minIndexForVisible: 1 } };
}
