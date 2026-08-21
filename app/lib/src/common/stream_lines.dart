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

  Line? _dialled;
  DateTime? _openedAt;

  /// The websocket URL to dial next, over whichever line is allowed to carry a stream right now.
  String urlFor(String path) {
    final line = selector.next();
    _dialled = line;
    _openedAt = null;
    final origin = line == null || line.url.isEmpty
        ? endpoints.origin
        : line.url;
    return endpoints.socketUrl(origin, path);
  }

  /// The connection is up. Until this is called the attempt counts as never having opened, which is
  /// what makes a line that accepts and immediately drops earn a penalty.
  void opened(DateTime now) {
    _openedAt = now;
    final line = _dialled;
    if (line != null) selector.opened(line);
  }

  /// The connection ended, however it ended.
  void closed(DateTime now) {
    final line = _dialled;
    if (line == null) return;
    final opened = _openedAt;
    selector.closed(
      line,
      opened == null ? Duration.zero : now.difference(opened),
    );
    _dialled = null;
    _openedAt = null;
  }
}
