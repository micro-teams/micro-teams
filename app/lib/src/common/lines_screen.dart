/// The developer line panel, behind a route nothing links to.
///
/// Everything MultiPath does is invisible when it works, which is exactly what makes it hard to
/// trust: there is nothing to see when it is fine, and nothing to see when it is not. This puts
/// what each line IS — its rank, its state, what has been measured about it — next to what actually
/// HAPPENED, which is whether the last request over it worked. Those two disagree more often than
/// you would expect, and the disagreement is usually where the bug is.
///
/// The React client had exactly this at `/__lines`, mounting the library's own panel. The Dart
/// package has no panel to mount, so this is one — the same question, asked in Flutter.
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
    final manager = ref.watch(linesProvider);
    final ranked = manager.ranked;

    return Scaffold(
      appBar: AppBar(
        title: const Text('lines'),
        actions: [
          IconButton(
            tooltip: 'measure now',
            // Measuring costs real requests, so nothing here polls: what is on screen is what was
            // known when it was drawn, and this is how you ask for more.
            onPressed: () async {
              await ref.read(probeLinesProvider)();
              if (mounted) setState(() {});
            },
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(
            'Ranked best first. A line with nothing measured sorts below one that has been, '
            'because unknown is not the same as fast.',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 16),
          for (final line in ranked)
            _LineRow(line: line, health: manager.health[line.id]),
          if (ranked.isEmpty)
            const Text(
              'no lines — the registry is empty, so everything goes to this origin',
            ),
        ],
      ),
    );
  }
}

class _LineRow extends StatelessWidget {
  const _LineRow({required this.line, required this.health});

  final mp.Line line;
  final mp.LineHealth health;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final colour = switch (health.state) {
      mp.LineState.up => scheme.primary,
      mp.LineState.degraded => Colors.amber,
      mp.LineState.down => scheme.error,
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
                Text(line.id, style: Theme.of(context).textTheme.titleSmall),
                const Spacer(),
                Text(
                  health.state.name,
                  style: Theme.of(
                    context,
                  ).textTheme.bodySmall?.copyWith(color: colour),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              line.url.isEmpty ? '(this origin)' : line.url,
              style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
            ),
            const SizedBox(height: 6),
            Text(
              [
                line.transport,
                'weight ${line.weight}',
                // Two measurements, because one is not enough: a line can answer a probe in 20ms
                // and still take seconds to deliver a megabyte, and that is the case this whole
                // library exists for.
                health.measured
                    ? '${health.latency!.inMilliseconds}ms'
                    : 'never measured',
                if (health.throughputBps > 0)
                  '${(health.throughputBps / 1000).round()} kB/s',
                if (health.consecutiveFailures > 0)
                  '${health.consecutiveFailures} failures in a row',
              ].join(' · '),
              style: Theme.of(context).textTheme.bodySmall,
            ),
            if (health.lastError != null) ...[
              const SizedBox(height: 6),
              Text(
                health.lastError!,
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
