// What the wire to a live screen promises the machine.
//
// These are not tests of a terminal — they are tests of the promises. A viewer that is not in
// `full` must not be able to type, because an agent keeps working on the assumption that nobody
// is; and stepping out of scroll must return the pane to the live screen, or one person paging
// through history leaves everyone else looking at the past.

import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:microteams/src/terminal/screen_link.dart';

/// A socket that records what was sent and lets a test push bytes back.
class _FakeSocket implements ScreenSocket {
  final _incoming = StreamController<Object?>.broadcast();
  final List<Object?> sent = [];
  bool closed = false;

  List<Map<String, Object?>> get jsonSent => sent
      .whereType<String>()
      .map((s) => jsonDecode(s) as Map<String, Object?>)
      .toList();

  List<Object?> get binarySent => sent.where((s) => s is! String).toList();

  void push(Object? data) => _incoming.add(data);
  void die() => _incoming.close();

  @override
  Stream<Object?> get incoming => _incoming.stream;

  @override
  void send(Object? data) => sent.add(data);

  @override
  void close() => closed = true;
}

ScreenLink linkTo(
  // ignore: library_private_types_in_public_api — a test helper is not an API
  _FakeSocket channel, {
  void Function(Uint8List)? onBytes,
  void Function()? onClosed,
}) => ScreenLink(
  url: () => 'ws://machine.test/mt/machine/screen/s1',
  onBytes: onBytes ?? (_) {},
  onClosed: onClosed ?? () {},
  connect: (_) => channel,
);

void main() {
  test('says what it is as soon as it arrives', () {
    final channel = _FakeSocket();
    linkTo(channel).open();

    expect(channel.jsonSent.first, {'type': 'control', 'level': 'passive'});
  });

  test('screen bytes reach the caller', () {
    final channel = _FakeSocket();
    final seen = <int>[];
    linkTo(channel, onBytes: seen.addAll).open();

    channel.push([104, 105]);

    return Future<void>.delayed(Duration.zero, () {
      expect(seen, [104, 105]);
    });
  });

  group('typing', () {
    test('is refused unless the viewer is in full', () {
      final channel = _FakeSocket();
      final link = linkTo(channel)..open();

      link.sendKeys('ls\r');
      expect(channel.binarySent, isEmpty);

      link.setMode(ViewMode.scroll, cols: 80, rows: 24);
      link.sendKeys('ls\r');
      expect(
        channel.binarySent,
        isEmpty,
        reason:
            'scroll is a promise to the machine that nobody is typing — an agent '
            'keeps working on the strength of it',
      );
    });

    test('goes out as bytes in full', () {
      final channel = _FakeSocket();
      final link = linkTo(channel)..open();

      link.setMode(ViewMode.full, cols: 80, rows: 24);
      link.sendKeys('ls\r');

      expect(channel.binarySent, hasLength(1));
      expect(
        utf8.decode((channel.binarySent.single as Uint8List).toList()),
        'ls\r',
      );
    });
  });

  group('modes', () {
    test('leaving scroll returns the pane to the live screen', () {
      final channel = _FakeSocket();
      final link = linkTo(channel)..open();
      link.setMode(ViewMode.scroll, cols: 80, rows: 24);
      channel.sent.clear();

      link.setMode(ViewMode.readonly, cols: 80, rows: 24);

      expect(
        channel.jsonSent,
        // equals(), not the bare map: matcher's contains() compares with ==, and two Maps with
        // the same entries are not == in Dart. Without this the assertion passes only by luck.
        contains(equals({'type': 'scroll', 'dir': 'bottom'})),
        reason:
            'otherwise one person paging through history leaves everyone else '
            'looking at the past',
      );
    });

    test('a mode change re-states the size and the control level', () {
      final channel = _FakeSocket();
      final link = linkTo(channel)..open();
      channel.sent.clear();

      link.setMode(ViewMode.full, cols: 100, rows: 30);

      expect(
        channel.jsonSent,
        containsAll(<Map<String, Object?>>[
          {'type': 'resize', 'cols': 100, 'rows': 30},
          {'type': 'control', 'level': 'full'},
        ]),
      );
    });

    test('a size of nothing is not sent', () {
      // A terminal that has not been laid out yet reports zero, and telling a real pty it is
      // 0x0 is how a hosted program gets confused about where it may draw.
      final channel = _FakeSocket();
      final link = linkTo(channel)..open();
      channel.sent.clear();

      link.sendSize(cols: 0, rows: 0);

      expect(channel.jsonSent, isEmpty);
    });
  });

  group('scrolling', () {
    test('is allowed in readonly, because reading back never types', () {
      final channel = _FakeSocket();
      final link = linkTo(channel)..open();
      channel.sent.clear();

      link.sendScroll(ScrollDirection.up);

      expect(channel.jsonSent, [
        {'type': 'scroll', 'dir': 'up'},
        {'type': 'control', 'level': 'scroll'},
      ]);
    });

    testWidgets('reverts the control level once the gesture stops', (
      tester,
    ) async {
      final channel = _FakeSocket();
      final link = linkTo(channel)..open();
      link.sendScroll(ScrollDirection.up);
      channel.sent.clear();

      await tester.pump(scrollIdle + const Duration(milliseconds: 100));

      expect(channel.jsonSent, [
        {'type': 'control', 'level': 'passive'},
      ]);
    });
  });

  test(
    'a closed socket is reported once, and not after we closed it',
    () async {
      final channel = _FakeSocket();
      var closures = 0;
      final link = linkTo(channel, onClosed: () => closures++)..open();

      link.close();
      channel.die();
      await Future<void>.delayed(Duration.zero);

      expect(
        closures,
        0,
        reason: 'we closed it; that is not a failure to report',
      );
    },
  );
}
