// Watching an agent is a glance, not a place — and a glance you can back out of.
//
// Two rules, and the second is the one the first version got wrong. The app underneath must stay
// exactly as it was (that is the whole reason this is drawn over it), AND back must close the
// terminal rather than the screen beneath it. The first version was mounted above the router, so
// the back gesture never reached it: back went to the previous page while the terminal stayed up.
// A frame you cannot pop is not on the display stack at all.

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:microteams/src/common/config.dart';
import 'package:microteams/src/providers.dart';
import 'package:microteams/src/terminal/scene.dart';
import 'package:microteams/src/terminal/screen_link.dart';

/// A socket that connects and then says nothing, so a test of the FRAME is not also a test of
/// whether a machine answers.
class _FakeSocket extends ScreenSocket {
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
    appBar: AppBar(title: const Text('underneath')),
    body: Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          TextField(key: const Key('draft'), controller: draft),
          Builder(
            builder: (context) => TextButton(
              onPressed: () =>
                  openScene(context, sid: 's1', nickname: 'agent3'),
              child: const Text('watch'),
            ),
          ),
        ],
      ),
    ),
  );
}

Widget _host() {
  final router = GoRouter(
    routes: [
      GoRoute(
        path: '/',
        builder: (context, state) => const _Underneath(),
        routes: [
          GoRoute(
            path: 'screen/:sessionId',
            pageBuilder: (context, state) => sceneFrame(
              sessionId: state.pathParameters['sessionId'] ?? '',
              nickname: state.uri.queryParameters['name'],
              connect: (_) => _FakeSocket(),
            ),
          ),
        ],
      ),
    ],
  );

  return ProviderScope(
    overrides: [
      // A native build has no origin of its own; the terminal asks for one as it is built.
      endpointsProvider.overrideWithValue(
        const Endpoints(origin: 'http://machine.test'),
      ),
    ],
    child: MaterialApp.router(routerConfig: router),
  );
}

Future<void> _watch(WidgetTester tester) async {
  await tester.tap(find.text('watch'));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('nothing is drawn until somebody asks', (tester) async {
    await tester.pumpWidget(_host());
    await tester.pumpAndSettle();

    expect(find.byTooltip('close'), findsNothing);
  });

  testWidgets('back closes the terminal, not the screen under it', (
    tester,
  ) async {
    // The bug this file exists for. Mounted above the router, the terminal stayed up and the page
    // beneath it went back instead.
    await tester.pumpWidget(_host());
    await tester.pumpAndSettle();
    await _watch(tester);

    // The system back gesture, not a back arrow: the terminal's header shows a close button, and
    // what is being tested is that the platform's own "back" reaches this frame.
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();

    expect(find.byTooltip('close'), findsNothing);
    expect(find.byType(_Underneath), findsOneWidget);
  });

  testWidgets('escape puts it away too', (tester) async {
    await tester.pumpWidget(_host());
    await tester.pumpAndSettle();
    await _watch(tester);

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();

    expect(find.byTooltip('close'), findsNothing);
  });

  testWidgets('the chrome is one row, and it is not a title bar', (
    tester,
  ) async {
    // A terminal is the content. The row above it carries the way out, the three modes and
    // compact — and not the agent's name, which you already knew: you got here from its face.
    await tester.pumpWidget(_host());
    await tester.pumpAndSettle();
    await _watch(tester);

    // Scoped to the frame: the page underneath has a header of its own, and it is still there.
    expect(
      find.descendant(
        of: find.byType(SceneFrame),
        matching: find.byType(AppBar),
      ),
      findsNothing,
    );
    expect(find.text('agent3'), findsNothing);
    expect(find.byTooltip('close'), findsOneWidget);
    expect(find.byTooltip('watching'), findsOneWidget);
    expect(find.byTooltip('compact'), findsOneWidget);
  });
}
