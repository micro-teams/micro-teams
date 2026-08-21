// Watching an agent is a glance, not a place.
//
// The React client mounted one live-screen overlay above the whole app: tapping any agent avatar
// anywhere raised it, Escape put it away, and underneath everything was exactly where you left it.
// The first Flutter cut made it a route, which replaced the list you were reading and the message
// you were half-way through typing — and coming back was your problem.

import 'package:flutter/material.dart';
import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:microteams/src/common/config.dart';
import 'package:microteams/src/providers.dart';
import 'package:microteams/src/terminal/scene.dart';
import 'package:microteams/src/terminal/screen_link.dart';

/// A socket that connects and then says nothing, so a test of the OVERLAY is not also a test of
/// whether a machine answers.
class _FakeSocket implements ScreenSocket {
  final _incoming = StreamController<Object?>.broadcast();

  @override
  Stream<Object?> get incoming => _incoming.stream;

  @override
  void send(Object? data) {}

  @override
  void close() => unawaited(_incoming.close());
}

/// The app underneath: something with state you would hate to lose.
class _Underneath extends StatefulWidget {
  const _Underneath();

  @override
  State<_Underneath> createState() => _UnderneathState();
}

class _UnderneathState extends State<_Underneath> {
  final draft = TextEditingController();

  @override
  Widget build(BuildContext context) => Scaffold(
    body: Center(
      child: TextField(key: const Key('draft'), controller: draft),
    ),
  );
}

Widget _host() => ProviderScope(
  overrides: [
    // A native build has no origin of its own; the terminal asks for one the moment it is built.
    endpointsProvider.overrideWithValue(
      const Endpoints(origin: 'http://machine.test'),
    ),
  ],
  child: MaterialApp(
    home: Stack(
      children: [
        const _Underneath(),
        SceneOverlay(connect: (_) => _FakeSocket()),
      ],
    ),
  ),
);

/// The container the overlay lives in, so a test can open one the way an avatar does.
ProviderContainer _containerOf(WidgetTester tester) =>
    ProviderScope.containerOf(tester.element(find.byType(SceneOverlay)));

void main() {
  testWidgets('nothing is drawn until there is something to watch', (
    tester,
  ) async {
    await tester.pumpWidget(_host());
    expect(find.text('Live screen'), findsNothing);
  });

  testWidgets('what was underneath is still there, and still has its state', (
    tester,
  ) async {
    await tester.pumpWidget(_host());
    await tester.enterText(find.byKey(const Key('draft')), 'half a message');
    await tester.pump();

    _containerOf(tester).read(sceneProvider.notifier).open('s1');
    // Settled, not sampled: the terminal schedules work when it appears, and a test that ends with
    // that still pending fails on the timer rather than on what it was asking about.
    await tester.pumpAndSettle();

    expect(
      tester.state<_UnderneathState>(find.byType(_Underneath)).draft.text,
      'half a message',
      reason:
          'the overlay floats over the app; it does not replace it, so nothing '
          'below it was rebuilt from scratch',
    );

    _containerOf(tester).read(sceneProvider.notifier).close();
    await tester.pumpAndSettle();
  });

  testWidgets('escape puts it away', (tester) async {
    await tester.pumpWidget(_host());
    _containerOf(
      tester,
    ).read(sceneProvider.notifier).open('s1', nickname: 'agent3');
    await tester.pumpAndSettle();
    expect(find.text('agent3'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();

    expect(find.text('agent3'), findsNothing);
  });

  testWidgets('and so does the visible way out', (tester) async {
    // Escape is not discoverable and a phone has no Escape key. An overlay with no visible way out
    // is a trap.
    await tester.pumpWidget(_host());
    _containerOf(
      tester,
    ).read(sceneProvider.notifier).open('s1', nickname: 'agent3');
    await tester.pumpAndSettle();

    await tester.tap(find.byTooltip('Close'));
    await tester.pumpAndSettle();

    expect(find.text('agent3'), findsNothing);
  });

  testWidgets('it is named after whoever is being watched', (tester) async {
    await tester.pumpWidget(_host());
    _containerOf(
      tester,
    ).read(sceneProvider.notifier).open('s1', nickname: 'agent3');
    await tester.pumpAndSettle();

    expect(find.text('agent3'), findsOneWidget);
    expect(find.text('Live screen'), findsNothing);
  });
}
