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
import 'package:microteams/src/providers.dart';
import 'package:microteams/src/common/config.dart';
import 'package:microteams/src/terminal/screen_link.dart';
import 'package:microteams/src/terminal/terminal_screen.dart';

class _FakeSocket implements ScreenSocket {
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
  testWidgets('shows what the machine sends', (tester) async {
    final socket = _FakeSocket();
    await tester.pumpWidget(host(socket));

    socket.push('hello from the machine');
    await tester.pumpAndSettle();

    // xterm draws its cells on a canvas rather than as Text widgets, so what is asserted here is
    // that the bytes were accepted and the screen is alive — not the pixels. The pixels were
    // judged on a real device, which is the only place that judgement means anything.
    expect(find.byType(TerminalScreen), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('opens as watching, and says so', (tester) async {
    final socket = _FakeSocket();
    await tester.pumpWidget(host(socket));
    await tester.pumpAndSettle();

    expect(find.text('Watching'), findsOneWidget);
    expect(
      socket.jsonSent.first,
      equals({'type': 'control', 'level': 'passive'}),
      reason:
          'the machine has to be told what we are before it decides whether the '
          'screen is trustworthy to sample',
    );
  });

  testWidgets('switching to typing tells the machine, with a size', (
    tester,
  ) async {
    final socket = _FakeSocket();
    await tester.pumpWidget(host(socket));
    await tester.pumpAndSettle();
    socket.sent.clear();

    await tester.tap(find.text('Typing'));
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
    await tester.pumpAndSettle();

    // A black rectangle and no explanation is the failure this whole project keeps finding: the
    // broken state and the working state look identical.
    expect(find.textContaining('dropped'), findsOneWidget);
  });
}
