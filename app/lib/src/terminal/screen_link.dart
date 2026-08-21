/// The wire to one live screen: raw bytes both ways, JSON for everything else.
///
/// Deliberately free of any terminal widget, so the awkward half — what a mode means, what a
/// gesture sends, what happens when the socket dies — can be tested without a device.
///
/// The protocol is the React viewer's, unchanged, because the server end is unchanged:
///   * binary frames are screen bytes (in) and keystrokes (out);
///   * `{"type":"control","level":…}` says what the human is doing, so the driver knows when the
///     screen is trustworthy to sample and when to hold its last verdict;
///   * `{"type":"resize","cols":…,"rows":…}` keeps the real pty the same size as what we draw;
///   * `{"type":"scroll","dir":…}` drives tmux copy-mode, because the hosted program is a
///     full-screen TUI that keeps no scrollback of its own — the history lives in tmux, and
///     PgUp sent to the program does nothing;
///   * `{"type":"compact"}` asks the driver to compact.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:web_socket_channel/web_socket_channel.dart';

/// The socket, narrowed to the four things this class needs.
///
/// Narrowed rather than used directly so a test can drive the awkward cases — a frame arriving, a
/// socket dying — without a server. A fake of the whole WebSocketChannel surface is a fake nobody
/// writes, and a class nobody can test is a class whose promises are only claims.
abstract class ScreenSocket {
  Stream<Object?> get incoming;
  void send(Object? data);
  void close();
}

class _WebSocket implements ScreenSocket {
  _WebSocket(Uri url) : _channel = WebSocketChannel.connect(url);

  final WebSocketChannel _channel;

  @override
  Stream<Object?> get incoming => _channel.stream;

  @override
  void send(Object? data) => _channel.sink.add(data);

  @override
  void close() => unawaited(_channel.sink.close());
}

/// What the viewer is allowed to do, and — the part that matters to the machine — what the driver
/// should assume about the human.
enum ViewMode {
  /// Watching. Never types. May still scroll: paging tmux history only reads back.
  readonly,

  /// Paging through history. The driver holds its last verdict rather than sampling a screen that
  /// is showing the past.
  scroll,

  /// Typing into the program.
  full;

  /// The word the connector and the drivers understand.
  String get controlLevel => switch (this) {
    ViewMode.full => 'full',
    ViewMode.scroll => 'scroll',
    ViewMode.readonly => 'passive',
  };
}

enum ScrollDirection { up, down, bottom }

/// How long after a scroll gesture the control level reverts. Long enough that a flick and its
/// follow-up are one gesture, short enough that a driver is not held off a live screen.
const Duration scrollIdle = Duration(seconds: 2);

class ScreenLink {
  ScreenLink({
    required this.url,
    required this.onBytes,
    required this.onClosed,
    ScreenSocket Function(Uri url)? connect,
  }) : _connect = connect ?? _WebSocket.new;

  /// Read per dial, so a reconnect after a token refresh carries the new token.
  final String Function() url;

  final void Function(Uint8List bytes) onBytes;

  /// Called when the socket goes away. Whether that is fatal is the screen's decision, not this
  /// class's: the first connection failing means "gone or not watchable", a later one means "try
  /// again", and only the caller knows which one this was.
  final void Function() onClosed;

  final ScreenSocket Function(Uri url) _connect;

  ScreenSocket? _channel;
  StreamSubscription<Object?>? _messages;
  Timer? _idle;
  ViewMode _mode = ViewMode.readonly;
  bool _closed = false;

  ViewMode get mode => _mode;
  bool get isOpen => _channel != null;

  void open() {
    _closed = false;
    final channel = _connect(Uri.parse(url()));
    _channel = channel;
    _messages = channel.incoming.listen(
      (Object? data) {
        if (data is List<int>) onBytes(Uint8List.fromList(data));
        // A text frame from the server is not part of this protocol today. Ignored rather than
        // treated as an error, so the server can learn a new word without breaking old clients.
      },
      onDone: _handleClosed,
      onError: (Object _) => _handleClosed(),
      cancelOnError: true,
    );
    // Say what we are as soon as we arrive, rather than leaving the driver to assume.
    sendControl();
  }

  void close() {
    _closed = true;
    _idle?.cancel();
    unawaited(_messages?.cancel());
    _channel?.close();
    _channel = null;
  }

  void _handleClosed() {
    if (_closed) return;
    _channel = null;
    onClosed();
  }

  /// Keystrokes. Only in [ViewMode.full] — the other modes are a promise to the machine that
  /// nobody is typing, and that promise is what lets an agent keep working while people watch.
  void sendKeys(String data) {
    if (_mode != ViewMode.full) return;
    _sendBinary(Uint8List.fromList(utf8.encode(data)));
  }

  void setMode(ViewMode next, {required int cols, required int rows}) {
    _mode = next;
    // Leaving scroll returns the pane to the live screen: tell the connector to leave any tmux
    // copy-mode it entered while we were paged back through history. Without this, stepping out of
    // scroll leaves the machine showing the past to everyone else too.
    if (next != ViewMode.scroll) {
      _sendJson({'type': 'scroll', 'dir': 'bottom'});
    }
    sendSize(cols: cols, rows: rows);
    sendControl();
  }

  void sendControl() {
    _sendJson({'type': 'control', 'level': _mode.controlLevel});
  }

  /// Tell the server our exact size, so the real terminal — a tmux client on a pty — matches what
  /// we draw.
  void sendSize({required int cols, required int rows}) {
    if (cols <= 0 || rows <= 0) return;
    _sendJson({'type': 'resize', 'cols': cols, 'rows': rows});
  }

  /// One step of tmux copy-mode scrolling, plus the fact that a human is doing it.
  ///
  /// Every mode may scroll, including readonly: paging history reads back, it never types. The
  /// control level reverts on its own once the gesture stops, so a viewer that scrolled once does
  /// not hold the driver off the live screen forever.
  void sendScroll(ScrollDirection dir) {
    _sendJson({'type': 'scroll', 'dir': dir.name});
    if (dir == ScrollDirection.bottom) return;
    _sendJson({'type': 'control', 'level': ViewMode.scroll.controlLevel});
    _idle?.cancel();
    _idle = Timer(scrollIdle, sendControl);
  }

  void compact() => _sendJson({'type': 'compact'});

  void _sendJson(Map<String, Object?> frame) {
    final channel = _channel;
    if (channel == null) return;
    try {
      channel.send(jsonEncode(frame));
    } catch (_) {
      // Dropped while closing. Everything this class sends is re-sent on the next open.
    }
  }

  void _sendBinary(Uint8List bytes) {
    final channel = _channel;
    if (channel == null) return;
    try {
      channel.send(bytes);
    } catch (_) {
      // Same: a keystroke lost to a closing socket is not worth crashing over.
    }
  }
}

void unawaited(Future<void>? future) {
  future?.catchError((Object _) {});
}
