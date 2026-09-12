// The rules the updates socket reconnects by, which are the JS package's rules.
//
// Two of them were wrong in a way no screen would ever show: the line was told a connection had
// opened at DIAL time rather than at the handshake, so a line that never answered looked like one
// that had held a connection for as long as the attempt took; and the backoff was forgiven at dial
// time too, so a line that accepts a socket and drops it immediately was retried every second
// forever, warmly and pointlessly.

import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:microteams/src/common/updates/socket.dart';
import 'package:microteams/src/common/updates/store.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

/// A socket that never completes its handshake and then dies.
class _NeverOpens implements WebSocketChannel {
  _NeverOpens();

  final _incoming = StreamController<Object?>();
  final _outgoing = StreamController<Object?>();

  void die() {
    unawaited(_incoming.close());
  }

  @override
  Future<void> get ready => Completer<void>().future;

  @override
  Stream<Object?> get stream => _incoming.stream;

  @override
  WebSocketSink get sink => _Sink(_outgoing.sink);

  @override
  dynamic noSuchMethod(Invocation invocation) => null;
}

class _Sink implements WebSocketSink {
  _Sink(this._inner);
  final StreamSink<Object?> _inner;

  @override
  void add(Object? data) => _inner.add(data);

  @override
  Future<void> close([int? closeCode, String? closeReason]) => _inner.close();

  @override
  dynamic noSuchMethod(Invocation invocation) => null;
}

void main() {
  test(
    'a line is credited when the handshake completes, not when it is dialled',
    () {
      final store = UpdatesStore();
      var opened = 0;
      final sockets = <_NeverOpens>[];
      final socket = UpdatesSocket(
        store: store,
        url: () => 'ws://line.test/mt/updates',
        connect: (_) {
          final made = _NeverOpens();
          sockets.add(made);
          return made;
        },
      )..onOpened = () => opened++;

      socket.start();
      addTearDown(socket.close);
      sockets.single.die();

      expect(
        opened,
        0,
        reason: 'nothing about that line has been proven by dialling it',
      );
    },
  );

  test(
    'resumed() redials immediately rather than waiting out the silence '
    'window',
    () {
      final store = UpdatesStore();
      var dials = 0;
      final sockets = <_NeverOpens>[];
      final socket = UpdatesSocket(
        store: store,
        url: () => 'ws://line.test/mt/updates',
        connect: (_) {
          dials++;
          final made = _NeverOpens();
          sockets.add(made);
          return made;
        },
      );

      socket.start();
      addTearDown(socket.close);
      expect(dials, 1, reason: 'the initial dial from start()');

      // The channel is still open by every signal this class can see — no onDone, no onError, and
      // well inside the 45s silence window a plain heartbeat would wait out. This is exactly the
      // shape of a socket built over an mp.Client that app.dart has just dropped on resume: nothing
      // about the abandoned channel itself ever says it died.
      socket.resumed();

      expect(
        dials,
        2,
        reason:
            'resume must redial on the spot, not rely on silence eventually '
            'accumulating past 45s',
      );
    },
  );
}
