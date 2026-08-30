// The terminal, driven without a machine.
//
// What a device is needed for — how scrolling feels, whether the soft keyboard behaves, whether it
// keeps up under load — no test can answer, and the probe answered separately. What a test CAN
// answer is whether the screen honours the promises the machine is relying on: that watching never
// types, and that a dead socket says so instead of showing a black rectangle forever.

import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:microteams/src/common/stream_lines.dart';
import 'package:multipath/multipath.dart' as mp;
import 'package:microteams/src/providers.dart';
import 'package:microteams/src/common/config.dart';
import 'package:microteams/src/terminal/screen_link.dart';
import 'package:microteams/src/terminal/terminal_screen.dart';

class _FakeSocket extends ScreenSocket {
  final _incoming = StreamController<Object?>.broadcast();
  final List<Object?> sent = [];

  List<Map<String, Object?>> get jsonSent => sent
      .whereType<String>()
      .map((s) => jsonDecode(s) as Map<String, Object?>)
      .toList();

  void push(String text) => _incoming.add(utf8.encode(text));
  void die() => unawaited(_incoming.close());

  @override
  Stream<Object?> get incoming => _incoming.stream;

  @override
  void send(Object? data) => sent.add(data);

  @override
  void close() {}
}

// ignore: library_private_types_in_public_api — a test helper is not an API
Widget host(_FakeSocket socket) => ProviderScope(
  overrides: [
    endpointsProvider.overrideWithValue(
      const Endpoints(origin: 'http://machine.test'),
    ),
  ],
  child: MaterialApp(
    home: TerminalScreen(sessionId: 's1', connect: (_) => socket),
  ),
);

void main() {
  testWidgets('the screen is dialled over a line, not over the page origin', (
    tester,
  ) async {
    // The live screen is the app's heaviest stream, and it was the last connection still hard-wired
    // to whichever host served the document.
    final socket = _FakeSocket();
    final dialled = <Uri>[];
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          endpointsProvider.overrideWithValue(
            const Endpoints(origin: 'http://machine.test'),
          ),
          streamLinesProvider.overrideWithValue(
            StreamLines(
              selector: mp.StreamSelector(
                lines: () => mp.parseRegistry({
                  'lines': [
                    {'id': 'near', 'url': 'https://near.example.com'},
                  ],
                }).lines,
              ),
              endpoints: const Endpoints(origin: 'http://machine.test'),
            ),
          ),
        ],
        child: MaterialApp(
          home: TerminalScreen(
            sessionId: 's1',
            connect: (url) {
              dialled.add(url);
              return socket;
            },
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(
      dialled.single.toString(),
      'wss://near.example.com/mt/machine/screen/s1',
    );
  });
  testWidgets('switching to typing tells the machine, with a size', (
    tester,
  ) async {
    final socket = _FakeSocket();
    await tester.pumpWidget(host(socket));
    await tester.pumpAndSettle();
    socket.sent.clear();

    await tester.tap(find.byTooltip('typing'));
    await tester.pumpAndSettle();

    expect(
      socket.jsonSent,
      contains(equals({'type': 'control', 'level': 'full'})),
    );
    final resize = socket.jsonSent.where((f) => f['type'] == 'resize');
    expect(resize, isNotEmpty);
    expect(resize.first['cols'], isPositive);
  });

  testWidgets('a socket that dies says so instead of going quiet', (
    tester,
  ) async {
    final socket = _FakeSocket();
    await tester.pumpWidget(host(socket));
    await tester.pumpAndSettle();

    socket.die();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 10));

    // A black rectangle and no explanation is the failure this whole project keeps finding: the
    // broken state and the working state look identical. It says "reconnecting" rather than
    // "dropped" because that is what is actually happening — the loop is running.
    expect(find.textContaining('reconnecting'), findsOneWidget);
  });

  testWidgets('a screen that fails to connect keeps trying, and comes back', (
    tester,
  ) async {
    // The case a person actually hits: the app has only just started, the first dial goes out
    // before there is anything to answer it, and the screen used to be dead for good — a red
    // banner, and nothing to do but leave and come back. Re-dialling is also what re-picks the
    // line, so an attempt over a line that cannot carry a stream is not the end of the screen.
    final sockets = <_FakeSocket>[];
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          endpointsProvider.overrideWithValue(
            const Endpoints(origin: 'http://machine.test'),
          ),
        ],
        child: MaterialApp(
          home: TerminalScreen(
            sessionId: 's1',
            connect: (_) {
              final socket = _FakeSocket();
              sockets.add(socket);
              // The first two attempts find nothing at the other end.
              if (sockets.length <= 2) socket.die();
              return socket;
            },
          ),
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 10));

    expect(find.textContaining('reconnecting'), findsOneWidget);

    // Long enough for the first two waits.
    await tester.pump(const Duration(seconds: 2));
    await tester.pumpAndSettle();

    expect(sockets, hasLength(3), reason: 'it kept asking');
    expect(find.textContaining('reconnecting'), findsNothing);
    expect(find.textContaining('dropped'), findsNothing);

    // And the screen that came back is a live one: bytes land in the terminal.
    sockets.last.push('hello');
    await tester.pumpAndSettle();
    expect(find.textContaining('gone'), findsNothing);
  });

  testWidgets('it keeps trying, and offers a way to skip the wait', (
    tester,
  ) async {
    // The JS package's rule, which this now follows: never stop. Every line in a MultiPath
    // deployment is expected to be less reliable than one well-chosen line, and that bet only pays
    // if recovering is automatic. What the button adds is impatience, not the only way back.
    final sockets = <_FakeSocket>[];
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          endpointsProvider.overrideWithValue(
            const Endpoints(origin: 'http://machine.test'),
          ),
        ],
        child: MaterialApp(
          home: TerminalScreen(
            sessionId: 's1',
            connect: (_) {
              final socket = _FakeSocket();
              sockets.add(socket);
              socket.die();
              return socket;
            },
          ),
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 10));
    // Four waits: 0.5s, 1s, 2s, 4s.
    await tester.pump(const Duration(seconds: 8));
    await tester.pump(const Duration(milliseconds: 10));

    final tried = sockets.length;
    expect(tried, greaterThan(3), reason: 'it is still going');
    expect(find.text('try again'), findsOneWidget);

    await tester.tap(find.text('try again'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 10));

    expect(sockets.length, greaterThan(tried));

    // And it is still trying afterwards, rather than the button having been the last chance.
    await tester.pump(const Duration(seconds: 2));
    await tester.pump(const Duration(milliseconds: 10));
    expect(sockets.length, greaterThan(tried + 1));
  });
}
