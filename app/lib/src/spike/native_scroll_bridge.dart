/// DISPOSABLE SPIKE. Delete `lib/src/spike/` once the scroll question is answered.
///
/// The one call from Dart into Kotlin: open the native-scrolled screen. The channel name is
/// prototype-scoped on purpose — `app.microteams.microteams/spike_scroll` will never be confused
/// with a real platform channel, and grepping for `spike_scroll` finds every piece of the
/// experiment on both sides of the boundary.
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

const MethodChannel _channel = MethodChannel(
  'app.microteams.microteams/spike_scroll',
);

/// Opens the native Activity. Callers must already have checked that this is Android — on any other
/// platform there is no handler on the other end, and a `MissingPluginException` is a worse answer
/// than a disabled button.
Future<void> openNativeScrollSpike(BuildContext context) async {
  final messenger = ScaffoldMessenger.maybeOf(context);
  try {
    await _channel.invokeMethod<void>('open');
  } on PlatformException catch (e) {
    messenger?.showSnackBar(
      SnackBar(content: Text('native scroll spike failed: ${e.message}')),
    );
  } on MissingPluginException {
    messenger?.showSnackBar(
      const SnackBar(
        content: Text('native scroll spike is only in the Android build'),
      ),
    );
  }
}
