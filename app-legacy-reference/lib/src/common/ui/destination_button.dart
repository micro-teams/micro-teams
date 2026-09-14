/// One destination, drawn one way, wherever it appears.
///
/// The rail down the side of a wide window and the bar across the bottom of a phone are the same
/// control arranged differently — a column of these or a row of them. They used to be two different
/// things (this, and Material's `NavigationBar`), which meant the buttons were square with the word
/// inside on a desktop and round-indicator-with-a-caption on a phone: the same app, wearing two
/// faces, and every later change to one of them had to be remembered for the other.
///
/// So the shape lives here and only here. What a shell decides is where they go, not what they look
/// like.
library;

import 'package:flutter/material.dart';

import 'theme.dart';

/// A place the app can be: what it is called, and what it looks like when you are there.
class Destination {
  const Destination({
    required this.path,
    required this.icon,
    required this.selected,
    required this.label,
  });

  final String path;
  final IconData icon;

  /// The filled variant, for when this is where you are. Two icons rather than a colour change:
  /// colour alone is not a difference everybody can see.
  final IconData selected;
  final String label;
}

class DestinationButton extends StatelessWidget {
  const DestinationButton({
    required this.destination,
    required this.active,
    required this.onTap,
    super.key,
  });

  final Destination destination;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final colour = active ? scheme.primary : scheme.onSurfaceVariant;

    return Tooltip(
      message: destination.label,
      child: Material(
        color: active ? scheme.surfaceContainerHighest : Colors.transparent,
        borderRadius: BorderRadius.circular(6),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(6),
          child: SizedBox(
            width: Metrics.railItemSize,
            height: Metrics.railItemSize,
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(
                  active ? destination.selected : destination.icon,
                  size: Metrics.railIconSize,
                  color: colour,
                ),
                const SizedBox(height: 2),
                Text(
                  destination.label,
                  style: TextStyle(
                    fontSize: Metrics.railLabelSize,
                    height: 1,
                    color: colour,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
