/// Boot.
///
/// The only thing that happens before the app is on screen is opening the read cache, because a
/// cold start that can paint from disk is the difference between "the app is slow" and "the app is
/// there". Everything else — asking the refresh cookie who this is, dialling the updates socket —
/// happens behind the first frame.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import './src/app.dart';
import 'src/providers.dart';
import 'package:multipath/multipath.dart' as mp;

import './src/common/key_value.dart';
import './src/common/lines.dart';
import './src/common/prefs_store.dart';
import './src/common/ready_signal.dart';
import './src/common/url_strategy.dart';

Future<void> main() async {
  final binding = WidgetsFlutterBinding.ensureInitialized();
  // Before the router exists, so the first route is read from a real path rather than a hash.
  configureUrlStrategy();
  // Both shelves are opened before the first frame so that what survived the last run can be
  // painted in it: a cold start that shows a spinner where content used to be reads as data loss,
  // and on a phone a cold start is most of the experience.
  final cache = mp.RequestCache(store: const PrefsCacheStore());
  await cache.restore();
  final state = await KeyValueStore.open();

  // One line manager for the whole app, adopting the deployment's real registry in the background.
  // Deliberately not awaited: the same-origin line is what the app was going to use anyway, and a
  // client that waited for a routing table would have made the transport a startup dependency —
  // exactly backwards for the thing whose job is to survive one route being down.
  final lines = mp.LineManager(registry: sameOriginOnly());

  runApp(
    ProviderScope(
      overrides: [
        requestCacheProvider.overrideWithValue(cache),
        stateStoreProvider.overrideWithValue(state),
        linesProvider.overrideWithValue(lines),
      ],
      child: const MicroTeamsApp(),
    ),
  );

  // After the first frame, tell the document the app is really on screen. On the web that mark is
  // the only honest answer to "did it start?" — the canvas exists either way. See ready_signal.dart.
  binding.addPostFrameCallback((_) => signalReady());
}
