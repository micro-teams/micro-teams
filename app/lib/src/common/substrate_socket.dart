/// A WebSocket carried inside the MultiPath substrate.
///
/// The app's two long-lived connections — the updates feed and a live terminal — are the traffic
/// redundancy is most worth having on: a request that fails can be sent again, while a socket that
/// drops takes the screen with it. Until now they were the one thing still dialled beside the
/// transport rather than inside it, so a line dying disconnected them even though every request the
/// app made survived it.
///
/// Uses multipath's own [mp.MultipathWebSocket] rather than implementing RFC 6455 ourselves — it is
/// pure Dart (no dart:io), so the same code path works on every platform, the web included since
/// MultiPath 0.2.0-rc.3 gave its Dart client a browser-native link layer. [substrate].live is null
/// only until the substrate has dialled, in which case the caller falls back to an ordinary
/// WebSocket.
library;

import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:multipath/multipath.dart' as mp;
import 'package:stream_channel/stream_channel.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import 'multipath_adapter.dart';

/// Constructs the same [WebSocketChannel] [socketOverSubstrate] does, over a handshake a test
/// controls directly instead of a real dial — the only way to exercise what happens to a write made
/// before that handshake settles.
@visibleForTesting
WebSocketChannel channelForTest(Future<mp.MultipathWebSocket> opening) =>
    _MultipathChannel(opening);

/// Opens [url] as a WebSocket carried on a mux stream, or returns null when there is no transport up
/// to carry it.
///
/// Null rather than an error, and the caller dials the ordinary way instead: a socket that refused
/// to open because the substrate was not up yet would make the live terminal depend on a transport
/// that is allowed to be absent.
///
/// It uses a transport that is already up and never starts one. Requests are what bring the
/// substrate up — they are frequent and short, and one going out directly costs nothing — whereas a
/// socket is held for hours, so a dial started here would be a wait at the worst moment and, on a
/// deployment with no origin, a retry loop nobody asked for.
WebSocketChannel? socketOverSubstrate(Substrate substrate, Uri url) {
  final client = substrate.live;
  if (client == null) return null;
  final path = url.path.isEmpty ? '/' : url.path;
  final target = url.hasQuery ? '$path?${url.query}' : path;
  return _MultipathChannel(client.openWebSocket(appService, target));
}

/// [WebSocketChannel] over multipath's own WebSocket, which is callback-based rather than a
/// [Stream]/[StreamSink] — see [mp.MultipathWebSocket]'s own doc for why (dart:io's Stream-shaped
/// WebSocket is itself dart:io-specific and unavailable on web, so there is nothing to delegate to).
/// This is the one place that translates between the two styles.
class _MultipathChannel
    with StreamChannelMixin<Object?>
    implements WebSocketChannel {
  _MultipathChannel(Future<mp.MultipathWebSocket> opening) {
    _readyCompleter.complete(
      opening
          .then((ws) {
            _ws = ws;
            // Guarded rather than trusted to fire in a tidy order: onDone can be called for the
            // peer's close frame while a message the read loop had already decoded is still in
            // flight to this callback, and StreamController.add after close throws — which would
            // turn an ordinary end-of-connection into a crash reported as a test failure with a
            // stack trace pointing at this file instead of at whatever actually happened on the
            // wire.
            ws.onMessage = (m) {
              if (_incoming.isClosed) return;
              _incoming.add(m.isText ? m.text : m.data);
            };
            ws.onError = (e) {
              if (_incoming.isClosed) return;
              _incoming.addError(e);
            };
            ws.onDone = () => unawaited(_incoming.close());
            // Everything the caller wrote before this future settled — sendControl() and the
            // terminal's very first, layout-driven resize both fire on this class's very first
            // microtask, long before a real network round trip can complete [_ws]'s dial. A plain
            // WebSocketChannel buffers a write made before its handshake finishes; this one used to
            // just drop it (see the old version of [_MultipathSink._send]), which is why a freshly
            // opened terminal never told the machine its real size until something else — a manual
            // resize, a mode change — sent one that arrived late enough to land. Flushed in the
            // order they were queued, exactly as a buffered send would have delivered them.
            if (_closed) return;
            for (final queued in _pending) {
              _sendNow(ws, queued);
            }
            _pending.clear();
          })
          .catchError((Object error, StackTrace stack) async {
            unawaited(_incoming.close());
            throw error;
          }),
    );
  }

  mp.MultipathWebSocket? _ws;
  final Completer<void> _readyCompleter = Completer<void>();
  final StreamController<Object?> _incoming = StreamController<Object?>();

  /// What [_MultipathSink.add] was handed before [_ws] existed to send it over. See the flush
  /// above for why this exists rather than sending being a no-op until the dial settles.
  final List<Object?> _pending = [];

  /// Set once [_MultipathSink.close] runs, so a dial that settles afterwards flushes nothing into
  /// a socket the caller already gave up on.
  bool _closed = false;

  @override
  Future<void> get ready => _readyCompleter.future;

  @override
  Stream<Object?> get stream => _incoming.stream;

  @override
  WebSocketSink get sink => _MultipathSink(this);

  @override
  String? get protocol => null;

  @override
  int? get closeCode => null;

  @override
  String? get closeReason => null;
}

class _MultipathSink implements WebSocketSink {
  _MultipathSink(this._channel);

  final _MultipathChannel _channel;

  void _send(Object? data) {
    if (data is! String && data is! Uint8List && data is! List<int>) {
      throw ArgumentError.value(data, 'data', 'must be String or byte list');
    }
    final ws = _channel._ws;
    // No connection yet: queued rather than dropped, and flushed once one exists — see the
    // comment where that flush happens, in _MultipathChannel's constructor.
    if (ws == null) {
      if (!_channel._closed) _channel._pending.add(data);
      return;
    }
    if (ws.isClosed) return;
    _sendNow(ws, data);
  }

  @override
  void add(Object? data) => _send(data);

  @override
  void addError(Object error, [StackTrace? stackTrace]) {}

  @override
  Future<void> addStream(Stream<Object?> stream) async {
    await for (final data in stream) {
      _send(data);
    }
  }

  @override
  Future<dynamic> close([int? closeCode, String? closeReason]) async {
    // Marked before the dial settles, not just left to _ws being null: a dial that resolves AFTER
    // this call must not flush [_pending] into a socket the caller has already given up on.
    _channel._closed = true;
    _channel._pending.clear();
    _channel._ws?.close();
  }

  @override
  Future<dynamic> get done =>
      _channel._ws == null ? Future.value() : _channel._incoming.done;
}

/// The one place that actually writes to an open [mp.MultipathWebSocket] — shared by an immediate
/// send and by the queue [_MultipathChannel] flushes once [ws] exists, so the two cannot drift
/// apart on which types they accept.
void _sendNow(mp.MultipathWebSocket ws, Object? data) {
  if (data is String) {
    ws.sendText(data);
  } else if (data is Uint8List) {
    ws.sendBinary(data);
  } else if (data is List<int>) {
    ws.sendBinary(Uint8List.fromList(data));
  }
}
