/// Which line carries a long-lived connection, and what to do when it breaks.
///
/// A stream cannot be raced: two connections are two conversations, each with its own state. So the
/// most that is possible is pick the best line and, when it breaks, pick again — which is what
/// MultiPath's [StreamSelector] decides. What this file adds is the small amount of app that has to
/// be true around it.
///
/// The part worth knowing: a line's ability to hold a STREAM is remembered separately from its
/// request latency, because the two say almost nothing about each other. A cheap reverse proxy will
/// serve requests perfectly and refuse the Upgrade; a middlebox will allow the handshake and then
/// sever anything long-lived. A line that fails at this is skipped for streams and stays perfectly
/// good for requests, and a connection that lasted before dropping is an ordinary disconnection and
/// is not held against it — otherwise every line is slowly penalised for the network being a
/// network.
library;

import 'package:multipath/multipath.dart';

import 'config.dart';

/// Wraps the selector with the two things a caller needs: a URL, and somewhere to report how the
/// attempt went.
class StreamLines {
  StreamLines({required this.selector, required this.endpoints});

  final StreamSelector selector;
  final Endpoints endpoints;

  /// Picks a line and returns everything one connection needs.
  ///
  /// Per connection rather than per manager, because the app holds more than one stream at a time —
  /// the updates socket and any number of live screens. A single "the line I dialled" field shared
  /// between them credits one socket's success to whichever line another socket happened to dial
  /// last, which is a wrong answer that looks like a right one.
  StreamDial dial(String path) {
    final line = selector.next();
    final origin = line == null || line.url.isEmpty
        ? endpoints.origin
        : line.url;
    return StreamDial._(selector, line, endpoints.socketUrl(origin, path));
  }
}

/// One attempt to hold one stream, and the line it went out over.
class StreamDial {
  StreamDial._(this._selector, this.line, this.url);

  final StreamSelector _selector;

  /// The line chosen, or null when there was none to choose and the page's own origin was used.
  final Line? line;

  final String url;

  DateTime? _openedAt;
  bool _closed = false;

  /// The connection is up. Until this is called the attempt counts as never having opened, which is
  /// what makes a line that accepts and immediately drops earn a penalty.
  void opened(DateTime now) {
    _openedAt = now;
    final chosen = line;
    if (chosen != null) _selector.opened(chosen);
  }

  /// The connection ended, however it ended. Reporting twice is not counted twice: a socket that
  /// errors and then completes is one ending, and penalising it twice would take a good line out of
  /// service for stream traffic.
  void closed(DateTime now) {
    if (_closed) return;
    _closed = true;
    final chosen = line;
    if (chosen == null) return;
    final opened = _openedAt;
    _selector.closed(
      chosen,
      opened == null ? Duration.zero : now.difference(opened),
    );
  }
}
