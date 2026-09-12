/// What the transport is doing, wherever it happens to live.
///
/// Two answers to one question, and the split is not an implementation detail: on a native client the
/// substrate is in this isolate and can simply be asked, while on the web it is in the service
/// worker, in front of the whole document, and the page cannot see it at all. So the worker answers
/// for itself at /__mt/transport (see web/sw.js) and this hides which of the two happened.
///
/// It exists because a redundant transport hides line failure from everything above it — that is its
/// purpose — so unless something asks out loud, a deployment can lose every path but one and nobody
/// finds out until the last one goes.
library;

import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

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

/// Asks whatever is holding the transport what it sees.
///
/// Never throws: a panel that could not be opened because the thing it reports on is broken would be
/// useless exactly when it is needed. An empty list means "nothing is carrying anything", which is
/// itself an answer and is rendered as one.
Future<List<LineReport>> transportStats(Substrate substrate) async {
  if (!kIsWeb) {
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
  try {
    final body = await _askTheWorker();
    final lines = (jsonDecode(body) as Map<String, Object?>)['lines'];
    if (lines is! List) return const [];
    return [
      for (final line in lines.whereType<Map<String, Object?>>())
        LineReport(
          name: 'line ${line['index']}',
          url: '${line['url'] ?? ''}',
          state: '${line['state'] ?? 'down'}',
          lastByteMs: (line['lastByteMs'] as num?)?.toInt() ?? 0,
          reconnects: (line['reconnects'] as num?)?.toInt() ?? 0,
          reason: '${line['reason'] ?? ''}',
        ),
    ];
  } catch (_) {
    // No worker, or one too old to answer. Nothing to report is the honest answer.
    return const [];
  }
}

/// Overridden in tests, which have no service worker to ask.
@visibleForTesting
Future<String> Function() askTheWorker = _fetchFromWorker;

Future<String> _askTheWorker() => askTheWorker();

/// A bare client on purpose: the app's own carries a token, a cache and an error translator, none of
/// which belong on a question the worker answers about itself.
Future<String> _fetchFromWorker() async {
  final response = await Dio().getUri<String>(
    Uri.base.resolve('/__mt/transport'),
    options: Options(responseType: ResponseType.plain),
  );
  return response.data ?? '{}';
}
