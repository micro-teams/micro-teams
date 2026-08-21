/// The one socket, and the loop that keeps it up.
///
/// A heartbeat is here for one specific failure and not for any other: a half-open socket, where
/// the connection is gone but no close event ever fires. That is the only thing a heartbeat can
/// detect. It cannot detect the failure this system is actually prone to — an event that was never
/// published at all — and nothing here should be read as covering that. The periodic state frame
/// from the server, compared against each subscriber's digest, is what covers that.
///
/// On a phone there is a second reason this file is careful: the OS suspends the process without
/// telling anyone, and the socket comes back as a corpse. Every path out of that ends in
/// [UpdatesStore.refocused] or a reconnect, both of which cost one refetch and cannot show
/// stale data.
library;

import 'dart:async';
import 'dart:convert';

import 'package:web_socket_channel/web_socket_channel.dart';

import 'protocol.dart';
import 'store.dart';

/// How long the socket may stay silent before we assume it is a corpse and reconnect.
const Duration _silence = Duration(seconds: 45);

/// How often we prod it. Well inside [_silence] so a healthy socket never trips the check.
const Duration _pingEvery = Duration(seconds: 20);

/// Reconnect backoff. Capped low: this socket carries nothing but "go and look", so dialling
/// again cheaply is better than being clever.
const Duration _minRetry = Duration(seconds: 1);
const Duration _maxRetry = Duration(seconds: 20);

class UpdatesSocket {
  UpdatesSocket({required UpdatesStore store, required this.url})
    : _store = store;

  final UpdatesStore _store;

  /// Called for each dial, so the token is always the current one — a socket that reconnects with
  /// yesterday's token is refused, and looks exactly like a server that has gone quiet.
  final String Function() url;

  /// Told when a dial succeeds and when it ends, so the line policy can learn which lines can hold
  /// a stream at all — a different question from which answers requests quickly. Optional because
  /// the terminal's socket and the tests do not have a policy to inform.
  void Function()? onOpened;
  void Function()? onClosed;

  WebSocketChannel? _channel;
  StreamSubscription<Object?>? _messages;
  Timer? _ping;
  Timer? _retry;
  DateTime _lastHeard = DateTime.now();
  Duration _backoff = _minRetry;
  bool _closed = false;

  void start() {
    _closed = false;
    _dial();
    _ping = Timer.periodic(_pingEvery, (_) => _heartbeat());
  }

  /// The app came back to the foreground.
  void resumed() {
    if (_closed) return;
    _store.refocused();
    // A socket that was suspended may be dead without knowing it. Prod it now rather than waiting
    // out the silence window, because the human is looking at the screen right now.
    _heartbeat();
  }

  void close() {
    _closed = true;
    _ping?.cancel();
    _retry?.cancel();
    unawaited(_messages?.cancel());
    _store.disconnected();
    _channel?.sink.close();
    _channel = null;
  }

  void _dial() {
    if (_closed) return;
    try {
      final channel = WebSocketChannel.connect(Uri.parse(url()));
      onOpened?.call();
      _channel = channel;
      _lastHeard = DateTime.now();
      _messages = channel.stream.listen(
        _onMessage,
        onDone: () {
          onClosed?.call();
          _onClosed();
        },
        onError: (Object _) => _onClosed(),
        cancelOnError: true,
      );
      _store.connected(_ChannelTransport(channel));
      _backoff = _minRetry;
    } catch (_) {
      _onClosed();
    }
  }

  void _onMessage(Object? data) {
    _lastHeard = DateTime.now();
    if (data is! String) return;
    final frame = parseFrame(data);
    if (frame != null) _store.handle(frame);
  }

  void _onClosed() {
    if (_closed) return;
    _store.disconnected();
    _channel = null;
    _retry?.cancel();
    _retry = Timer(_backoff, _dial);
    final next = _backoff * 2;
    _backoff = next > _maxRetry ? _maxRetry : next;
  }

  void _heartbeat() {
    if (_closed) return;
    final channel = _channel;
    if (channel == null) return;
    if (DateTime.now().difference(_lastHeard) > _silence) {
      // Nothing has arrived for a long time, not even our own pong. Close it and let the reconnect
      // loop dial again — a socket that is dead but not closed is the one thing this timer exists
      // to notice.
      channel.sink.close();
      _onClosed();
      return;
    }
    try {
      channel.sink.add(jsonEncode(const PingFrame().toJson()));
    } catch (_) {
      _onClosed();
    }
  }
}

class _ChannelTransport implements UpdatesTransport {
  _ChannelTransport(this._channel);

  final WebSocketChannel _channel;

  @override
  void send(ClientFrame frame) {
    try {
      _channel.sink.add(jsonEncode(frame.toJson()));
    } catch (_) {
      // Dropped while closing; the next connect resubscribes everything.
    }
  }
}
