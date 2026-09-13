/// DISPOSABLE SPIKE. Delete `lib/src/spike/` once the scroll question is answered, and with it the
/// `/__scroll` route in `src/app.dart`, the Kotlin files under `android/`, and the activity entry in
/// `AndroidManifest.xml`. That is the whole footprint, on purpose.
///
/// THE QUESTION: scrolling here is reported to be visibly rougher than WeChat on a low-end Android
/// phone. Would letting native Android own the scroll gesture, with Flutter still rendering all the
/// content, be meaningfully smoother? Two screens, the same 200 fake rows, live frame statistics on
/// each, and a phone in a hand decide it.
///
/// Nothing links here. It is reached by typing `/__scroll`, following the precedent of `/__lines`.
library;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import 'fake_rows.dart';
import 'frame_stats.dart';
import 'native_scroll_bridge.dart';
// Imported so the second entrypoint's library is part of this app's compilation. It is never
// called from Dart — Kotlin names it — and an unreferenced library would not be compiled at all,
// which no amount of `vm:entry-point` can rescue.
// ignore: unused_import
import 'native_scroll_entry.dart';

class ScrollSpikeScreen extends StatelessWidget {
  const ScrollSpikeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final nativeAvailable =
        !kIsWeb && defaultTargetPlatform == TargetPlatform.android;
    return Scaffold(
      appBar: AppBar(title: const Text('scroll spike')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Text(
            'Two screens, the same 200 fake rows. Flick each one hard for about five seconds and '
            'compare the numbers at the bottom. Hit reset first so you are measuring the flick and '
            'not the screen opening.',
          ),
          const SizedBox(height: 20),
          FilledButton(
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => const FlutterListSpikeScreen(),
              ),
            ),
            child: const Text('A — pure Flutter list (the control)'),
          ),
          const SizedBox(height: 8),
          const Text(
            'An ordinary ListView.builder, exactly how the app scrolls today. Flutter builds, lays '
            'out and rasterises rows on every frame of the scroll.',
            style: TextStyle(fontSize: 12, color: Colors.black54),
          ),
          const SizedBox(height: 24),
          FilledButton(
            onPressed: nativeAvailable
                ? () => openNativeScrollSpike(context)
                : null,
            child: Text(
              nativeAvailable
                  ? 'B — native-scrolled list (the experiment)'
                  : 'B — native-scrolled list (Android only)',
            ),
          ),
          const SizedBox(height: 8),
          Text(
            nativeAvailable
                ? 'An Android ScrollView panning over a FlutterView that is three screens tall and '
                      'was rendered once. Flutter does no per-frame work while you pan; the frame '
                      'numbers come from Android\'s Choreographer instead.'
                : 'This half is a native Android Activity, so it only exists in the Android build. '
                      'On web and in tests the button is disabled rather than throwing.',
            style: const TextStyle(fontSize: 12, color: Colors.black54),
          ),
          const SizedBox(height: 24),
          const Text(
            'Caveat worth remembering while reading the numbers: variant B renders through a '
            'TextureView, which is itself somewhat slower than the SurfaceView the real app uses. '
            'B is running with a handicap, so a clear win for B means more than a tie does.',
            style: TextStyle(fontSize: 12, color: Colors.black54),
          ),
        ],
      ),
    );
  }
}

/// Variant A. The control: this is what the app does today.
class FlutterListSpikeScreen extends StatelessWidget {
  const FlutterListSpikeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final rows = buildSpikeRows();
    return Scaffold(
      backgroundColor: spikePageColour,
      appBar: AppBar(title: const Text('A — pure Flutter')),
      body: FlutterFrameReadout(
        child: ListView.builder(
          // The real thread screen builds rows inside itemBuilder for the reason recorded in
          // thread_screen.dart, and so does this, or the control would not be the control.
          itemCount: rows.length,
          itemBuilder: (context, i) => SpikeBubble(row: rows[i]),
          // Room for the readout bar, so the last row is not hidden under it.
          padding: const EdgeInsets.only(top: 6, bottom: 96),
        ),
      ),
    );
  }
}
