/// The developer line panel, behind a route nothing links to.
///
/// Everything the substrate does is invisible when it works, which is exactly what makes it hard to
/// trust: there is nothing to see when it is fine, and nothing to see when it is not. Under 0.2.0
/// that got worse rather than better, and this panel is the answer. Redundancy means a line can die
/// and cost nobody anything — no error, no slowdown, no reconnect — so a deployment can lose three
/// of its four paths in complete silence and only find out when the last one goes, by which time it
/// is an outage instead of a warning. This is where that shows.
///
/// What it no longer shows is a ranking. Latency, throughput and "which line is preferred" answered
/// a question the substrate deleted: nothing picks a line, every line carries every byte, and the
/// fastest one wins each byte without anybody measuring anything. What is left is the question that
/// still has an answer — is this path alive, has it been flapping, and what killed it last time.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:multipath/multipath.dart' as mp;

import '../providers.dart';

class LinesScreen extends ConsumerStatefulWidget {
  const LinesScreen({super.key});

  @override
  ConsumerState<LinesScreen> createState() => _LinesScreenState();
}

class _LinesScreenState extends ConsumerState<LinesScreen> {
  @override
  Widget build(BuildContext context) {
    final substrate = ref.watch(substrateProvider);
    final stats = substrate.stats();

    return Scaffold(
      appBar: AppBar(
        title: const Text('lines'),
        actions: [
          IconButton(
            tooltip: 'refresh',
            // Nothing polls: what is on screen is what the transport knew when it was drawn. A view
            // that refreshed itself would hide the one thing worth noticing here, which is a line
            // whose state changed while you were looking at the old value.
            onPressed: () => setState(() {}),
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(
            'Every line carries every byte; the first copy to arrive is the one used. So none of '
            'these is "the" line, and a line being down costs nothing until it is the last one.',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 16),
          for (final stat in stats)
            _LineRow(url: substrate.urlOf(stat.index), stat: stat),
          if (stats.isEmpty)
            const Text(
              'no transport yet — nothing has been sent, or there is no line to send it over',
            ),
        ],
      ),
    );
  }
}

class _LineRow extends StatelessWidget {
  const _LineRow({required this.url, required this.stat});

  final String url;
  final mp.LinkStat stat;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final colour = switch (stat.state) {
      'up' => scheme.primary,
      'connecting' => Colors.amber,
      _ => scheme.error,
    };

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 8,
                  height: 8,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: colour,
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  'line ${stat.index}',
                  style: Theme.of(context).textTheme.titleSmall,
                ),
                const Spacer(),
                Text(
                  stat.state,
                  style: Theme.of(
                    context,
                  ).textTheme.bodySmall?.copyWith(color: colour),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              url.isEmpty ? '(this origin)' : url,
              style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
            ),
            const SizedBox(height: 6),
            Text(
              [
                // The recovery count, because "up" at the instant you look says nothing about a
                // path that has come and gone forty times this morning — and flapping is the
                // failure this panel is most likely to be the only witness to.
                if (stat.reconnects > 0) 'recovered ${stat.reconnects}×',
                if (stat.lastByteMs > 0)
                  'last byte ${DateTime.fromMillisecondsSinceEpoch(stat.lastByteMs).toIso8601String()}'
                else
                  'nothing has arrived on it',
              ].join(' · '),
              style: Theme.of(context).textTheme.bodySmall,
            ),
            if (stat.reason.isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(
                stat.reason,
                style: Theme.of(
                  context,
                ).textTheme.bodySmall?.copyWith(color: scheme.error),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
