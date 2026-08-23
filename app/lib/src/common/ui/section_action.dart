/// The small action that sits at the right-hand end of a section heading.
///
/// One control, because there were two: the machine detail's "add to team" is a quiet piece of text
/// you press, and the fleet's "add device" and "open agent" were filled tonal buttons — loud enough
/// that they read as the point of the screen rather than as the thing you do occasionally. The
/// quiet one is right: a heading is a label, and a button inside a label should not outweigh it.
library;

import 'package:flutter/material.dart';

/// The label alone, for a caller that supplies its own gesture — a popup menu, say, which has to
/// own the tap itself.
class SectionActionLabel extends StatelessWidget {
  const SectionActionLabel(this.label, {super.key});

  final String label;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
    child: Text(
      label,
      style: Theme.of(context).textTheme.labelMedium?.copyWith(
        color: Theme.of(context).colorScheme.primary,
      ),
    ),
  );
}

class SectionAction extends StatelessWidget {
  const SectionAction({
    required this.label,
    required this.onPressed,
    super.key,
  });

  final String label;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => TextButton(
    onPressed: onPressed,
    style: TextButton.styleFrom(
      visualDensity: VisualDensity.compact,
      padding: EdgeInsets.zero,
      minimumSize: Size.zero,
      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
    ),
    child: SectionActionLabel(label),
  );
}
