// A session that failed to restore must not cost the first frame.
//
// This is the shape of "the loading screen sits at 100% and nothing happens". The router's redirect
// asked the session provider for its value, `AsyncValue.value` RETHROWS when the provider is in an
// error state, and a throw inside redirect means no route resolves — so nothing is ever painted,
// the app never marks itself ready, and the launcher's percentage stays where it was. Opening
// /login by hand appeared to fix it, which is what a bug in route resolution looks like from
// outside.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:microteams/src/app.dart';
import 'package:microteams/src/auth/auth_api.dart';
import 'package:microteams/src/common/config.dart';
import 'package:microteams/src/providers.dart';

class _Failed extends SessionController {
  @override
  Future<Session?> build() async => throw StateError('the network went away');
}

void main() {
  testWidgets('a session that could not be restored still paints a screen', (
    tester,
  ) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          sessionProvider.overrideWith(_Failed.new),
          endpointsProvider.overrideWithValue(
            const Endpoints(origin: 'http://backend.test'),
          ),
        ],
        child: const MicroTeamsApp(),
      ),
    );
    await tester.pumpAndSettle();

    // Not signed in is what a failed restore MEANS, so this is the login screen — and the important
    // part is that there is a screen at all.
    expect(tester.takeException(), isNull);
    expect(find.byType(MaterialApp), findsOneWidget);
    expect(find.textContaining('sign in', findRichText: true), findsWidgets);
  });
}
