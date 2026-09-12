/// What the transport is doing.
///
/// It exists because a redundant transport hides line failure from everything above it — that is its
/// purpose — so unless something asks out loud, a deployment can lose every path but one and nobody
/// finds out until the last one goes.
library;

import 'multipath_adapter.dart';

/// One line, as a view wants to read it: which path it is, what state it is in, and the two facts
/// that give away a path that has been flapping.
class LineReport {
  const LineReport({
    required this.name,
    required this.url,
    required this.state,
    required this.lastByteMs,
    required this.reconnects,
    required this.reason,
  });

  final String name;
  final String url;

  /// "up", "connecting" (never yet up) or "down" (was up, now reconnecting).
  final String state;
  final int lastByteMs;
  final int reconnects;
  final String reason;
}

/// Asks the substrate what it sees on each line.
Future<List<LineReport>> transportStats(Substrate substrate) async {
  return [
    for (final stat in substrate.stats())
      LineReport(
        name: 'line ${stat.index}',
        url: substrate.urlOf(stat.index),
        state: stat.state,
        lastByteMs: stat.lastByteMs,
        reconnects: stat.reconnects,
        reason: stat.reason,
      ),
  ];
}
