/*
 * The look, in one place: every colour and measurement the app draws with.
 *
 * colors — the one dark theme: a black page, a green-tinted neutral ramp, WeChat's bubbles and
 *   send button. metrics — the sizes screens share. fonts — the monospace family the whole UI is
 *   set in, with the Chinese faces that draw what it lacks. WIDE — the one breakpoint between the
 *   phone layout and the list-beside-detail one.
 *
 * type — the text styles (below), by Material 3's names: title, body, small, label and so on.
 *
 * Example: <View style={{ backgroundColor: colors.page, width: metrics.listPane }} />
 *
 * Monospace throughout because a chat full of paths, ids and command output lines up. A value
 * changes here or nowhere, so two screens cannot drift a shade apart.
 */
import { isWeb } from "../platform/platform";

export const colors = {
  /** The brand green — selection, focus, primary buttons. */
  brand: "#4FCC5B",
  page: "#000000",
  card: "#0A0A0A",
  raised: "#141414",
  hover: "#1B1B1B",
  /** A button that cannot be pressed yet, and the quieter "tonal" button beside a field. */
  disabled: "#262626",
  line: "#242424",
  ink: "#DDE8DD",
  inkMuted: "#798479",
  danger: "#E62B34",
  /** WeChat's send button; not the brand green. */
  send: "#07C160",
  ownBubble: "#95EC69",
  ownBubbleInk: "#111111",
  otherBubble: "#2C2C2E",
  otherBubbleInk: "#FFFFFF",
  /** The pulsing ring of an agent that is working. */
  working: "#7C3AED",
} as const;

export const metrics = {
  railWidth: 64,
  railItem: 44,
  railIcon: 20,
  railLabel: 10,
  listPane: 320,
  readingColumn: 768,
  avatarInList: 48,
  avatarInDenseList: 44,
  avatarInBubble: 40,
  avatarRadius: 6,
  bubbleRadius: 6,
  bubblePadH: 12,
  bubblePadV: 8,
  bubbleText: 14,
  bubbleMaxFraction: 0.72,
  rowTitlePhone: 16,
  rowTitleDense: 14,
  headerHeight: 56,
  composerHeight: 40,
} as const;

/** Phone layout below this width, list-beside-detail at or above it. */
export const WIDE = 840;

/**
 * The text styles: Material 3's type scale set in the monospace
 * face — the size, the line, and the letter spacing, which in a monospace face is much of its look
 * (M3 spaces body text 0.25 px, small 0.4, labels 0.5).
 */
export const type = {
  body: { fontSize: 14, lineHeight: 20, letterSpacing: 0.25 },
  small: { fontSize: 12, lineHeight: 16, letterSpacing: 0.4 },
  label: { fontSize: 11, lineHeight: 16, letterSpacing: 0.5 },
  title: { fontSize: 16, lineHeight: 24, letterSpacing: 0.15 },
} as const;

export const fonts = {
  // On the web the faces come from public/fonts (see public/index.html), Chinese included; a phone
  // draws Chinese with its system's Noto CJK, the same family.
  mono: isWeb ? "LiberationMono, 'MT Noto Sans SC', monospace" : "LiberationMono",
} as const;
