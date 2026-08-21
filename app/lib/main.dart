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

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final cache = await ReadCache.open();

  runApp(
    ProviderScope(
      overrides: [cacheProvider.overrideWithValue(cache)],
      child: const MicroTeamsApp(),
    ),
  );
}
