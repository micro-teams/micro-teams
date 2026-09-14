/// Alive or not, said the same way everywhere.
///
/// A machine, an agent, a row, a detail header — all of them answer the same question, so all of
/// them use this. It was drawn three slightly different ways before, which is how "connected" ends
/// up meaning two things on two screens.
library;

import 'package:flutter/material.dart';

class OnlineDot extends StatelessWidget {
  const OnlineDot({required this.online, this.showLabel = true, super.key});

  final bool online;

  /// The word beside the dot. Off in tight places — a list row's trailing edge — where the colour
  /// is doing the work and there is no room for a second signal.
  final bool showLabel;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final colour = online ? scheme.primary : scheme.onSurfaceVariant;

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 8,
          height: 8,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: online ? colour : colour.withValues(alpha: 0.5),
          ),
        ),
        if (showLabel) ...[
          const SizedBox(width: 4),
          Text(
            online ? 'online' : 'offline',
            style: Theme.of(
              context,
            ).textTheme.bodySmall?.copyWith(color: colour),
          ),
        ],
      ],
    );
  }
}
