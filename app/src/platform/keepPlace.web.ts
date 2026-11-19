/*
 * The web half of keepPlace.ts. useKeepPlace(scroller, first) → no props: a browser has no
 * maintainVisibleContentPosition, and its own scroll anchoring does not do this. It does nothing
 * at a scroll offset of 0, which is where a fling to the top lands, and it anchors on the status
 * line whenever that is in view, so the old messages are pushed down below the new ones. It is
 * switched off for the scroll view (overflow-anchor: none), and when first changes while the
 * message that used to be first is still there, the offset is moved by exactly how far the end
 * of that message was pushed down: every message after it moved by that much, including the one
 * being read (the old first message can itself lose the time above it). That is done in a
 * layout effect: after the new rows are in the page, before the browser paints them.
 *
 * Example: <ScrollView ref={list} {...useKeepPlace(list, messages[0]?.id)}>…</ScrollView>
 */
import { type RefObject, useLayoutEffect, useRef } from "react";
import type { ScrollViewProps } from "react-native";
import type { KeyboardChatScrollViewRef } from "react-native-keyboard-controller";

const NO_PROPS: ScrollViewProps = {};

const end = (row: HTMLElement) => row.offsetTop + row.offsetHeight;

export function useKeepPlace(scroller: RefObject<KeyboardChatScrollViewRef | null>, first: unknown): ScrollViewProps {
  // The first message as drawn at the last render: its key, its element and how far down it ended.
  const held = useRef<{ first: unknown; row: HTMLElement; end: number } | null>(null);
  useLayoutEffect(() => {
    const node = scroller.current?.getScrollableNode() as HTMLElement | undefined;
    // The content container's second child: the first message, under the status line.
    const row = node?.firstElementChild?.children[1] as HTMLElement | undefined;
    if (!node || !row) return;
    node.style.overflowAnchor = "none";
    const was = held.current;
    if (was && was.first !== undefined && was.first !== first && was.row.isConnected) node.scrollTop += end(was.row) - was.end;
    held.current = { first, row, end: end(row) };
  });
  return NO_PROPS;
}
