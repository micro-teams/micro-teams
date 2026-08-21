/// The look, in one place.
///
/// Material 3's own state layers do the work the React client had to hand-roll in Tailwind — the
/// press ripple, the hover tint, the focus ring. That is most of what "feels native on Android"
/// means, and it is free as long as this file does not fight it. So this is a colour scheme and a
/// few density choices, not a re-skin.
library;

import 'package:flutter/material.dart';

/// The one brand colour. Everything else is derived, so a change here moves the whole app rather
/// than half of it.
const Color seed = Color(0xFF3B6CF6);

ThemeData lightTheme() => _theme(Brightness.light);
ThemeData darkTheme() => _theme(Brightness.dark);

ThemeData _theme(Brightness brightness) {
  final scheme = ColorScheme.fromSeed(seedColor: seed, brightness: brightness);
  return ThemeData(
    colorScheme: scheme,
    useMaterial3: true,
    visualDensity: VisualDensity.adaptivePlatformDensity,
    appBarTheme: AppBarTheme(
      backgroundColor: scheme.surface,
      surfaceTintColor: scheme.surfaceTint,
      centerTitle: false,
    ),
    inputDecorationTheme: const InputDecorationTheme(
      border: OutlineInputBorder(),
      isDense: true,
    ),
  );
}

/// Breakpoint between the phone layout (one screen at a time) and the desktop one (list beside
/// detail). One number, named, because two screens disagreeing about where "wide" starts is how a
/// layout ends up with three states instead of two.
const double wideBreakpoint = 840;

bool isWide(BuildContext context) =>
    MediaQuery.sizeOf(context).width >= wideBreakpoint;

/// The terminal's font. Bundled, because Flutter draws its own text and does not inherit the
/// platform's monospace family — see pubspec.yaml.
const String monoFamily = 'LiberationMono';
