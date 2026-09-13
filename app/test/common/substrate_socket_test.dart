// Regression test for a write made before the substrate's WebSocket has actually opened.
//
// _MultipathChannel wraps a Future<mp.MultipathWebSocket> — the real handshake takes a genuine
// network round trip. But the terminal's very first resize (xterm.dart computes its layout and
// calls Terminal.onResize on the widget's first frame, independent of the network) and ScreenLink's
// own sendControl() both fire in the SAME microtask [socketOverSubstrate] returns in, long before
// that handshake can possibly have completed. Sending through the sink before this class had a real
// [mp.MultipathWebSocket] to write to used to just drop the data on the floor (see the old
// _MultipathSink._send, which read `if (ws == null || ws.isClosed) return;`) — which is why a
// freshly opened live terminal never told the machine its real size until something else sent a
// resize late enough to land after the handshake finished.
library;

import 'dart:async';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:microteams/src/common/substrate_socket.dart';
import 'package:multipath/multipath.dart' as mp;

void main() {
  test(
    'a write before the handshake completes is queued and flushed, not dropped',
    () async {
      final fake = _FakeMultipathWebSocket();
      final opening = Completer<mp.MultipathWebSocket>();

      final channel = channelForTest(opening.future);

      // Written before the handshake has settled — exactly what a terminal's first-frame resize
      // and ScreenLink.sendControl() do in practice.
      channel.sink.add('{"type":"resize","cols":80,"rows":24}');
      channel.sink.add('{"type":"control","level":"full"}');

      expect(
        fake.sentText,
        isEmpty,
        reason: 'nothing to flush into yet — the handshake has not resolved',
      );

      opening.complete(fake);
      await Future<void>.delayed(Duration.zero);

      expect(
        fake.sentText,
        [
          '{"type":"resize","cols":80,"rows":24}',
          '{"type":"control","level":"full"}',
        ],
        reason:
            'both early writes must reach the socket, in the order they were '
            'made, once it actually opens',
      );
    },
  );

  test(
    'a write after the handshake completes still goes straight through',
    () async {
      final fake = _FakeMultipathWebSocket();
      final channel = channelForTest(Future.value(fake));
      await channel.ready;

      channel.sink.add('{"type":"control","level":"full"}');
      expect(fake.sentText, ['{"type":"control","level":"full"}']);
    },
  );

  test(
    'closing before the handshake settles drops the queue rather than flushing it later',
    () async {
      final fake = _FakeMultipathWebSocket();
      final opening = Completer<mp.MultipathWebSocket>();
      final channel = channelForTest(opening.future);

      channel.sink.add('{"type":"resize","cols":80,"rows":24}');
      await channel.sink.close();

      opening.complete(fake);
      await Future<void>.delayed(Duration.zero);

      expect(
        fake.sentText,
        isEmpty,
        reason:
            'the caller gave up on this socket; a late handshake must not '
            'resurrect a write to it',
      );
    },
  );
}

class _FakeMultipathWebSocket implements mp.MultipathWebSocket {
  final sentText = <String>[];
  final sentBinary = <Uint8List>[];
  bool _closed = false;

  @override
  bool get isClosed => _closed;

  @override
  void sendText(String text) => sentText.add(text);

  @override
  void sendBinary(Uint8List data) => sentBinary.add(data);

  @override
  void close() => _closed = true;

  @override
  void Function(Object) onError = (_) {};

  @override
  void Function() onDone = () {};

  @override
  void Function(mp.WSMessage) onMessage = (_) {};
}
