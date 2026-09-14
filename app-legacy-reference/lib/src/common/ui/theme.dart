/// The look, in one place.
///
/// These are not new colours. They are the React client's own palette, read out of a running build
/// rather than copied from the stylesheet by eye: the old theme wrote everything in `oklch(...)`,
/// so every value below was resolved by asking a browser what those actually paint. That is the
/// only way the two clients can be compared at all — "looks about right" is how a rewrite ends up
/// a shade off everywhere and nobody can say where.
///
/// Two deliberate departures from the old values, both asked for:
///
///   * the page is BLACK (`#000000`) where the old one was `#060606`, and the whole neutral ramp
///     below it moved down with it. Moving only the background would have left cards *lighter*
///     than a surface that is supposed to sit under them, which reads as a mistake rather than as
///     a darker theme.
///   * there is no light theme. The old client had one `:root` and it was dark; a light mode that
///     nothing was ever designed against is not a feature, it is an untested second app. The web
///     build follows the browser's preference by default, which is exactly how the new client came
///     out looking nothing like the old one on a machine set to light.
///
/// Material 3's state layers still do the press ripple, the hover tint and the focus ring. This
/// file gives them colours to work with; it does not re-implement them.
library;

import 'package:flutter/material.dart';

/// The brand green. `oklch(0.75 0.19 145)` in the old stylesheet.
const Color brandGreen = Color(0xFF4FCC5B);

/// The neutral ramp, darkest first. The old client's `--background` … `--border`, shifted down so
/// the page itself is true black.
const Color _page = Color(0xFF000000); // was #060606
const Color _card = Color(0xFF0A0A0A); // was #0B0B0B
const Color _raised = Color(0xFF141414); // --muted #161616
const Color _hover = Color(0xFF1B1B1B); // --secondary / --accent
const Color _line = Color(0xFF242424); // --border / --input

const Color _ink = Color(0xFFDDE8DD); // --foreground
const Color _inkMuted = Color(0xFF798479); // --muted-foreground
const Color _danger = Color(0xFFE62B34); // --destructive

/// The send button's green. Not the brand green: the React composer used WeChat's own #07c160
/// here, and it is the one control in the app that is copying a specific product on purpose.
const Color sendGreen = Color(0xFF07C160);

/// WeChat-ish bubble colours, taken verbatim from the React `MessageList.tsx` constants so the two
/// clients cannot drift apart on the one screen people actually look at.
const Color ownBubble = Color(0xFF95EC69);
const Color ownBubbleInk = Color(0xFF111111);
const Color otherBubble = Color(0xFF2C2C2E);
const Color otherBubbleInk = Color(0xFFFFFFFF);

/// The one theme. Named `darkTheme` because that is what it is, not because there is a sibling.
ThemeData darkTheme() {
  const scheme = ColorScheme.dark(
    primary: brandGreen,
    onPrimary: _page,
    primaryContainer: brandGreen,
    onPrimaryContainer: _page,
    secondary: _hover,
    onSecondary: _ink,
    surface: _page,
    onSurface: _ink,
    surfaceContainerLowest: _page,
    surfaceContainerLow: _card,
    surfaceContainer: _card,
    surfaceContainerHigh: _raised,
    surfaceContainerHighest: _hover,
    onSurfaceVariant: _inkMuted,
    outline: _line,
    outlineVariant: _line,
    error: _danger,
    onError: Colors.white,
  );

  // The whole UI is monospace, as the old one was. It is the single strongest thing about how this
  // product looks, and it is not decoration: a chat full of paths, ids and command output lines up.
  final base = ThemeData(colorScheme: scheme, useMaterial3: true);
  final text = base.textTheme
      .apply(fontFamily: monoFamily)
      .apply(fontFamilyFallback: fontFallback);

  return base.copyWith(
    // The Play Store press effect, which is Android 12's: a soft, edgeless glow that fades out,
    // NOT a circle with a boundary expanding from the touch point. That is InkSparkle — Flutter's
    // port of the platform's own ripple shader — and it is the whole reason a stock Material app
    // on Android 12+ feels different from one on Android 11.
    //
    // The highlight underneath is off as well. Material draws a fast splash AND a slow-fading
    // highlight; on a dark theme the highlight lags visibly behind and reads as a second, sluggish
    // animation on top of the first.
    splashFactory: InkSparkle.splashFactory,
    highlightColor: Colors.transparent,
    hoverColor: _hover,
    scaffoldBackgroundColor: _page,
    canvasColor: _page,
    textTheme: text,
    primaryTextTheme: text,
    dividerColor: _line,
    dividerTheme: const DividerThemeData(color: _line, space: 1, thickness: 1),
    visualDensity: VisualDensity.adaptivePlatformDensity,
    appBarTheme: AppBarTheme(
      backgroundColor: _page,
      foregroundColor: _ink,
      // A tinted app bar over a black page is the single most obvious "this is a stock Material
      // app" tell, and the old client had none.
      surfaceTintColor: Colors.transparent,
      scrolledUnderElevation: 0,
      elevation: 0,
      centerTitle: false,
      // 16px, regular. Measured off the React header, not chosen: Material's default title is
      // 20px and half a weight heavier, which is most of why screens "felt bigger than before".
      toolbarHeight: 56,
      // Every header in the React client sat on a 1px line. Without it a black header and a black
      // body are one undivided field, and the title looks like it is floating in the content.
      shape: const Border(bottom: BorderSide(color: _line)),
      titleTextStyle: text.titleMedium?.copyWith(
        color: _ink,
        fontSize: 16,
        fontWeight: FontWeight.w400,
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: _page,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      indicatorColor: Colors.transparent,
      height: 55,
      labelTextStyle: WidgetStateProperty.resolveWith(
        (states) => text.labelMedium?.copyWith(
          color: states.contains(WidgetState.selected) ? brandGreen : _inkMuted,
        ),
      ),
      iconTheme: WidgetStateProperty.resolveWith(
        (states) => IconThemeData(
          size: 22,
          color: states.contains(WidgetState.selected) ? brandGreen : _inkMuted,
        ),
      ),
    ),
    navigationRailTheme: NavigationRailThemeData(
      backgroundColor: _page,
      indicatorColor: _hover,
      selectedIconTheme: const IconThemeData(color: brandGreen, size: 22),
      unselectedIconTheme: const IconThemeData(color: _inkMuted, size: 22),
      selectedLabelTextStyle: text.labelMedium!.copyWith(color: brandGreen),
      unselectedLabelTextStyle: text.labelMedium!.copyWith(color: _inkMuted),
    ),
    // One size for a row's name and one for what is under it, set here rather than at each list.
    // A tree row written at 14 next to a fleet row written at Material's default 16 is two lists
    // that were meant to be one column, and neither of them looks wrong until you see the other.
    listTileTheme: ListTileThemeData(
      selectedTileColor: _hover,
      iconColor: _inkMuted,
      titleTextStyle: text.bodyMedium,
      subtitleTextStyle: text.bodySmall?.copyWith(color: _inkMuted),
    ),
    inputDecorationTheme: InputDecorationTheme(
      isDense: true,
      filled: false,
      hintStyle: text.bodyMedium?.copyWith(color: _inkMuted),
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      border: _fieldBorder(_line),
      enabledBorder: _fieldBorder(_line),
      focusedBorder: _fieldBorder(brandGreen),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: brandGreen,
        foregroundColor: _page,
        textStyle: text.labelLarge,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: brandGreen,
        textStyle: text.labelLarge,
      ),
    ),
    progressIndicatorTheme: const ProgressIndicatorThemeData(color: brandGreen),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: _raised,
      contentTextStyle: text.bodyMedium?.copyWith(color: _ink),
    ),
  );
}

OutlineInputBorder _fieldBorder(Color color) => OutlineInputBorder(
  borderRadius: BorderRadius.circular(6),
  borderSide: BorderSide(color: color),
);

/// The measurements, in one place, all read off the React client in a browser rather than chosen.
/// They are here rather than inline so that "the same size as before" is a thing this file can be
/// asked about, instead of a property spread across five widgets.
class Metrics {
  const Metrics._();

  /// The desktop rail: 64px wide, and each destination is a 44px rounded SQUARE with its icon and
  /// its label both inside it — the React rail's `size-11 rounded-lg text-[10px]` button. Material's
  /// NavigationRail cannot be talked into that shape (its indicator wraps the icon and the label
  /// sits outside), which is why the rail here is hand-drawn.
  static const double railWidth = 64;
  static const double railItemSize = 44;
  static const double railIconSize = 20;
  static const double railLabelSize = 10;

  /// The chat list beside an open conversation.
  static const double listPaneWidth = 320;

  /// A conversation does not run the full width of a wide window; it sits in a centred column.
  /// 768px, which is what makes a bubble cap out at 553px there.
  static const double readingColumn = 768;

  /// Avatars, all rounded squares of the same radius.
  ///
  /// Three call sites, and the React client had three sizes for them: 48 in the phone chat list,
  /// 44 in the list beside a conversation, 40 next to a message. The middle one matters — with 48
  /// beside a 40 the two read as different controls on a desktop, which is exactly what it looked
  /// like. 44 beside 40 does not.
  static const double avatarInList = 48;
  static const double avatarInDenseList = 44;
  static const double avatarInBubble = 40;
  static const double avatarRadius = 6;

  /// Bubbles: 6px corners, 8/12 padding, 14px text, capped at 72% of the column.
  static const double bubbleRadius = 6;
  static const EdgeInsets bubblePadding = EdgeInsets.symmetric(
    horizontal: 12,
    vertical: 8,
  );
  static const double bubbleTextSize = 14;
  static const double bubbleMaxFraction = 0.72;

  /// A chat row is taller on a phone (16px title) than beside a conversation (14px).
  static const double rowTitlePhone = 16;
  static const double rowTitleDense = 14;

  /// The composer. The input and the button are the same height, because two controls side by side
  /// at different heights is the sort of thing you cannot stop seeing once you have seen it.
  static const double composerHeight = 40;
}

/// Breakpoint between the phone layout (one screen at a time) and the desktop one (list beside
/// detail). One number, named, because two screens disagreeing about where "wide" starts is how a
/// layout ends up with three states instead of two.
const double wideBreakpoint = 840;

bool isWide(BuildContext context) =>
    MediaQuery.sizeOf(context).width >= wideBreakpoint;

/// The app's font. Bundled, because Flutter draws its own text and does not inherit the platform's
/// monospace family — see pubspec.yaml. The terminal needs it to line up; the rest of the app uses
/// it because the product looks like this.
const String monoFamily = 'LiberationMono';

/// What draws a glyph the mono font does not have — Chinese, chiefly.
///
/// Bundled rather than left to the engine. CanvasKit has no access to the system's fonts, so a
/// missing glyph sends it to fonts.gstatic.com at the moment the text is drawn: boxes for the first
/// second on every start, and boxes forever on a network that cannot reach Google.
const List<String> fontFallback = ['NotoSansSC'];
