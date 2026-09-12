/// A WebSocket carried inside the MultiPath substrate.
///
/// The app's two long-lived connections — the updates feed and a live terminal — are the traffic
/// redundancy is most worth having on: a request that fails can be sent again, while a socket that
/// drops takes the screen with it. Until now they were the one thing still dialled beside the
/// transport rather than inside it, so a line dying disconnected them even though every request the
/// app made survived it.
///
/// Uses multipath's own [mp.MultipathWebSocket] rather than implementing RFC 6455 ourselves — it is
/// pure Dart (no dart:io), so the same code path works whether or not the caller ends up able to
/// use it. On the web it never is: nothing dials the substrate there in the first place (the
/// service worker carries the network instead — see worker_routes.dart), so [substrate].live is
/// always null and every caller falls back to an ordinary WebSocket, exactly as before.
library;

import 'dart:async';
import 'dart:typed_data';

import 'package:multipath/multipath.dart' as mp;
import 'package:stream_channel/stream_channel.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import 'multipath_adapter.dart';

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
            ws.onMessage = (m) => _incoming.add(m.isText ? m.text : m.data);
            ws.onError = (e) => _incoming.addError(e);
            ws.onDone = () => unawaited(_incoming.close());
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
    final ws = _channel._ws;
    if (ws == null || ws.isClosed) return;
    if (data is String) {
      ws.sendText(data);
    } else if (data is Uint8List) {
      ws.sendBinary(data);
    } else if (data is List<int>) {
      ws.sendBinary(Uint8List.fromList(data));
    } else {
      throw ArgumentError.value(data, 'data', 'must be String or byte list');
    }
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
    _channel._ws?.close();
  }

  @override
  Future<dynamic> get done =>
      _channel._ws == null ? Future.value() : _channel._incoming.done;
}
