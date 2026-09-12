/// Boot.
///
/// The only thing that happens before the app is on screen is opening the read cache, because a
/// cold start that can paint from disk is the difference between "the app is slow" and "the app is
/// there". Everything else — asking the refresh cookie who this is, dialling the updates socket —
/// happens behind the first frame.
library;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import './src/app.dart';
import 'src/providers.dart';

import './src/common/key_value.dart';
import './src/common/prefs_store.dart';
import './src/common/request_cache.dart';
import './src/common/ready_signal.dart';
import './src/common/url_strategy.dart';

Future<void> main() async {
  final binding = WidgetsFlutterBinding.ensureInitialized();
  // Before the router exists, so the first route is read from a real path rather than a hash.
  configureUrlStrategy();

  // Who draws the copy button, on a touch screen.
  //
  // On the web Flutter leaves the context menu to the browser, which is right on a desktop: a
  // right-click gives you the browser's own menu, with its own Copy, and that is what a web page
  // does. On a phone there is no right-click — the copy button is supposed to appear over the
  // selection when you lift your finger — and the browser does not offer one for text that was
  // drawn into a canvas. So the selection worked and there was no way to copy it.
  //
  // Turning the browser's menu off here lets Flutter draw its own toolbar, which does appear on a
  // long press. Only on touch platforms: a desktop browser's menu is better than ours, and it is
  // what people expect from a page.
  if (kIsWeb &&
      (defaultTargetPlatform == TargetPlatform.android ||
          defaultTargetPlatform == TargetPlatform.iOS)) {
    await BrowserContextMenu.disableContextMenu();
  }
  // Both shelves are opened before the first frame so that what survived the last run can be
  // painted in it: a cold start that shows a spinner where content used to be reads as data loss,
  // and on a phone a cold start is most of the experience.
  final cache = RequestCache(store: const PrefsCacheStore());
  await cache.restore();
  final state = await KeyValueStore.open();

  // The transport is NOT built here. A version of this file built its own line manager, which had
  // no way to send a probe and nowhere to remember what it measured, and it quietly replaced the
  // one in providers.dart that had both — so production ran on the poorer copy while the tests,
  // which use the provider, exercised the good one. The probing is gone now but the rule it taught
  // is not: a provider with wiring in it is built in exactly one place.

  runApp(
    ProviderScope(
      overrides: [
        requestCacheProvider.overrideWithValue(cache),
        stateStoreProvider.overrideWithValue(state),
      ],
      child: const MicroTeamsApp(),
    ),
  );

  // After the first frame, tell the document the app is really on screen. On the web that mark is
  // the only honest answer to "did it start?" — the canvas exists either way. See ready_signal.dart.
  binding.addPostFrameCallback((_) => signalReady());
}
