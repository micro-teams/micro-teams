/// DISPOSABLE SPIKE. Delete `lib/src/spike/` once the scroll question is answered.
///
/// Variant B's Dart half: a SECOND Dart entrypoint, run by a second `FlutterEngine` that Kotlin
/// starts inside `SpikeNativeScrollActivity`. It renders the fake rows ONCE into a `FlutterView`
/// that is about three screens tall and then does nothing; Android's `ScrollView` pans over that
/// already-rendered surface. Flutter doing no per-frame work during the pan is the entire
/// hypothesis being tested.
///
/// Two things here are load-bearing and easy to get wrong:
///
///   * The entrypoint the engine is told to run is `spikeNativeScrollMain` in `lib/main.dart`, NOT
///     a function in this file, and it carries `@pragma('vm:entry-point')` there. Two separate
///     release-only traps live here: without the pragma the function is tree-shaken away, and named
///     by a non-main library URI it resolves to nothing at all in AOT. Both look identical from a
///     phone — a blank FlutterView, no error — and both work perfectly in every debug build.
///   * NO `ListView`, NO scroll view, NO viewport. A `Column` that simply IS three screens tall,
///     clipped by an `OverflowBox` so that overflowing the bottom is a non-event rather than a
///     yellow-and-black error stripe. Every row is laid out and painted once, up front. Putting any
///     lazy list here would silently turn variant B back into variant A.
///
/// Kotlin asks for the entrypoint BY NAME ONLY, against the default library — see
/// `SpikeNativeScrollActivity.kt` and `spikeNativeScrollMain` in `lib/main.dart`.
library;

import 'package:flutter/material.dart';

import 'fake_rows.dart';

/// Called by `spikeNativeScrollMain` in `lib/main.dart`, which is the name Kotlin actually asks the
/// engine for. It lives in the default library rather than here because a secondary entrypoint
/// named by a non-main library URI resolves to nothing in an AOT release build — see that function.
void runSpikeNativeScroll() {
  runApp(const _SpikeTallSurface());
}

class _SpikeTallSurface extends StatelessWidget {
  const _SpikeTallSurface();

  @override
  Widget build(BuildContext context) {
    final rows = buildSpikeRows();
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      home: ColoredBox(
        color: spikePageColour,
        // The Column is as tall as its children make it, which is more than the three screens the
        // native view gives it. OverflowBox lifts the height constraint so that is legal, ClipRect
        // keeps the extra off screen, and the top alignment pins row zero to the top. The cost of
        // laying out rows that fall past the bottom is paid once at startup — which is exactly the
        // trade this variant is proposing.
        child: ClipRect(
          child: OverflowBox(
            alignment: Alignment.topCenter,
            maxHeight: double.infinity,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const SizedBox(height: 6),
                for (final row in rows) SpikeBubble(row: row),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
