/// DISPOSABLE SPIKE. Delete `lib/src/spike/` once the scroll question is answered.
///
/// The ruler for variant A (pure Flutter). It exists so the comparison produces a NUMBER rather
/// than a feeling — `thread_screen.dart`'s own comment records what happens otherwise: a frame
/// count written down once, describing a machine that no longer exists, surviving in a comment long
/// after it stopped being true.
///
/// Deliberately the same statistics, computed the same way, as `tool/measure-frames.mjs`, so the
/// two can be compared instead of being two rulers:
///
///   * `frames` — samples collected since the last reset.
///   * over-budget count — samples longer than one refresh interval. That tool hardcodes 16.7ms
///     because a headless Chromium is always 60Hz; a phone is not, so the budget here is read from
///     the display and shown next to the number. "42 over budget" means nothing without it.
///   * percentiles picked as `sorted[floor(n * q)]`, the same off-by-a-bit convention that tool
///     uses, so p50 here and medianMs there are the same statistic.
///
/// What is measured is TOTAL frame time (`FrameTiming.totalSpan`, build + raster), not just build:
/// a frame the raster thread took 30ms on is a frame the user saw late, whoever was slow.
library;

import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';

/// Frames, gathered from the engine until told to stop.
class SpikeFrameStats {
  SpikeFrameStats({required this.budgetMs});

  /// One refresh interval, in ms, of the display this is running on.
  final double budgetMs;

  final List<double> _samples = <double>[];

  int get count => _samples.length;

  int get overBudget => _samples.where((ms) => ms > budgetMs).length;

  void add(double ms) => _samples.add(ms);

  void reset() => _samples.clear();

  /// `sorted[floor(n * q)]`, clamped — measure-frames.mjs's convention, kept on purpose.
  double percentile(double q) {
    if (_samples.isEmpty) return 0;
    final sorted = List<double>.of(_samples)..sort();
    final i = (sorted.length * q).floor();
    return sorted[i.clamp(0, sorted.length - 1)];
  }

  double get worst => percentile(1);
}

/// The readout, wired to `addTimingsCallback`. Variant A wraps its list in this.
class FlutterFrameReadout extends StatefulWidget {
  const FlutterFrameReadout({super.key, required this.child});

  final Widget child;

  @override
  State<FlutterFrameReadout> createState() => _FlutterFrameReadoutState();
}

class _FlutterFrameReadoutState extends State<FlutterFrameReadout> {
  SpikeFrameStats _stats = SpikeFrameStats(budgetMs: 16.7);
  double _refreshHz = 60;
  int _shown = -1;

  @override
  void initState() {
    super.initState();
    SchedulerBinding.instance.addTimingsCallback(_onTimings);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // The refresh rate is a property of the view, so it is only knowable once there is one. Read
    // every time rather than cached: a phone that drops to 60Hz to save battery changes the budget
    // underneath the measurement, and a stale budget is exactly the kind of wrong number this spike
    // is supposed to avoid.
    final hz = View.of(context).display.refreshRate;
    if (hz > 0 && hz != _refreshHz) {
      _refreshHz = hz;
      _stats = SpikeFrameStats(budgetMs: 1000 / hz);
    }
  }

  @override
  void dispose() {
    SchedulerBinding.instance.removeTimingsCallback(_onTimings);
    super.dispose();
  }

  void _onTimings(List<FrameTiming> timings) {
    for (final t in timings) {
      _stats.add(t.totalSpan.inMicroseconds / 1000.0);
    }
    // Repainting on every batch would itself be work during the scroll being measured, so the
    // readout only redraws when the frame count crosses a multiple of 15 — about four times a
    // second while flicking.
    final bucket = _stats.count ~/ 15;
    if (bucket != _shown) {
      _shown = bucket;
      if (mounted) setState(() {});
    }
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        widget.child,
        Positioned(
          left: 0,
          right: 0,
          bottom: 0,
          child: SpikeReadoutBar(
            title: 'Flutter (SchedulerBinding timings)',
            refreshHz: _refreshHz,
            budgetMs: _stats.budgetMs,
            frames: _stats.count,
            overBudget: _stats.overBudget,
            p50: _stats.percentile(0.5),
            p90: _stats.percentile(0.9),
            p99: _stats.percentile(0.99),
            worst: _stats.worst,
            onReset: () => setState(() {
              _stats.reset();
              _shown = -1;
            }),
          ),
        ),
      ],
    );
  }
}

/// The shared look of both readouts, so the two variants' numbers read as one instrument. The
/// native side draws its own copy of this in Kotlin; keep the wording in step if either changes.
class SpikeReadoutBar extends StatelessWidget {
  const SpikeReadoutBar({
    super.key,
    required this.title,
    required this.refreshHz,
    required this.budgetMs,
    required this.frames,
    required this.overBudget,
    required this.p50,
    required this.p90,
    required this.p99,
    required this.worst,
    required this.onReset,
  });

  final String title;
  final double refreshHz;
  final double budgetMs;
  final int frames;
  final int overBudget;
  final double p50;
  final double p90;
  final double p99;
  final double worst;
  final VoidCallback onReset;

  @override
  Widget build(BuildContext context) {
    final text = const TextStyle(
      color: Colors.white,
      fontSize: 12,
      fontFamily: 'monospace',
      height: 1.4,
    );
    return Material(
      color: Colors.black.withValues(alpha: 0.82),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 8, 8),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '$title — ${refreshHz.toStringAsFixed(1)}Hz, '
                      'budget ${budgetMs.toStringAsFixed(1)}ms',
                      style: text,
                    ),
                    Text(
                      'frames $frames   over budget $overBudget '
                      '(${frames == 0 ? 0 : (overBudget * 100 / frames).round()}%)',
                      style: text,
                    ),
                    Text(
                      'p50 ${p50.toStringAsFixed(1)}  p90 ${p90.toStringAsFixed(1)}  '
                      'p99 ${p99.toStringAsFixed(1)}  worst ${worst.toStringAsFixed(1)} ms',
                      style: text,
                    ),
                  ],
                ),
              ),
              TextButton(
                onPressed: onReset,
                child: const Text(
                  'reset',
                  style: TextStyle(color: Colors.amber),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
