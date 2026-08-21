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
  final text = base.textTheme.apply(fontFamily: monoFamily);

  return base.copyWith(
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
    listTileTheme: const ListTileThemeData(
      selectedTileColor: _hover,
      iconColor: _inkMuted,
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

  /// The desktop rail: 64px wide, 44px targets, a 10px label under each icon.
  static const double railWidth = 64;
  static const double railItemSize = 44;
  static const double railLabelSize = 10;

  /// The chat list beside an open conversation.
  static const double listPaneWidth = 320;

  /// A conversation does not run the full width of a wide window; it sits in a centred column.
  /// 768px, which is what makes a bubble cap out at 553px there.
  static const double readingColumn = 768;

  /// Avatars. Two sizes, and only two: the list uses the larger, a message bubble the smaller.
  /// The React client used exactly these, and the same rounded-square radius for both.
  static const double avatarInList = 48;
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
