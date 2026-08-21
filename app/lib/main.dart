/// Boot.
///
/// The only thing that happens before the app is on screen is opening the read cache, because a
/// cold start that can paint from disk is the difference between "the app is slow" and "the app is
/// there". Everything else — asking the refresh cookie who this is, dialling the updates socket —
/// happens behind the first frame.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'src/app.dart';
import 'src/app_providers.dart';
import 'src/core/cache.dart';
import 'src/core/ready_signal.dart';
import 'src/core/url_strategy.dart';

Future<void> main() async {
  final binding = WidgetsFlutterBinding.ensureInitialized();
  // Before the router exists, so the first route is read from a real path rather than a hash.
  configureUrlStrategy();
  final cache = await ReadCache.open();

  runApp(
    ProviderScope(
      overrides: [cacheProvider.overrideWithValue(cache)],
      child: const MicroTeamsApp(),
    ),
  );

  // After the first frame, tell the document the app is really on screen. On the web that mark is
  // the only honest answer to "did it start?" — the canvas exists either way. See ready_signal.dart.
  binding.addPostFrameCallback((_) => signalReady());
}
