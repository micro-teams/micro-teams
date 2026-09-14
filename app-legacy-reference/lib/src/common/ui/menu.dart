/// The one menu in this app.
///
/// There were four: two `PopupMenuButton`s, a hand-rolled `showMenu`, and a third button that
/// opened a different-looking list of the same kind of choices. Four things that are the same idea
/// drift — different padding, different text size, and one of them fades in while the others do
/// not — and the reader is the one who notices, without being able to say what is wrong.
///
/// Built on [MenuAnchor] rather than on `PopupMenuButton`, for two reasons that are both about
/// behaviour rather than taste. It appears at once, with no fade: a menu is a response to a tap and
/// a response that takes 150ms to arrive reads as hesitation. And the chosen value comes back
/// through the caller's own closure rather than through the button's state — the old
/// `PopupMenuButton` handed its answer to itself, and delivered nothing at all if the button had
/// been removed in the meantime, which is exactly what a row that hides its button when the pointer
/// leaves does.
library;

import 'package:flutter/material.dart';

/// Anything that can appear in a menu: a line, or the space between groups of lines.
sealed class AppMenuEntry<T> {
  const AppMenuEntry();
}

/// One line of a menu.
class AppMenuItem<T> extends AppMenuEntry<T> {
  const AppMenuItem({
    required this.value,
    required this.label,
    this.icon,
    this.checked = false,
    this.danger = false,
  });

  final T value;
  final String label;
  final IconData? icon;

  /// A tick down the left, for a menu that shows which one you are already on.
  final bool checked;

  /// Deleting something. Drawn in the error colour, because a list in which every line looks the
  /// same is a list where the irreversible one is one row away from the harmless one.
  final bool danger;
}

/// A separator between groups.
class AppMenuDivider<T> extends AppMenuEntry<T> {
  const AppMenuDivider();
}

class AppMenu<T> extends StatelessWidget {
  const AppMenu({
    required this.items,
    required this.onSelected,
    required this.child,
    this.tooltip,
    super.key,
  });

  final List<AppMenuEntry<T>> items;
  final void Function(T value) onSelected;

  /// What opens it. A button, a name, an avatar — the menu does not care.
  final Widget child;

  final String? tooltip;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;

    return MenuAnchor(
      style: MenuStyle(
        backgroundColor: WidgetStatePropertyAll(scheme.surfaceContainerHigh),
        surfaceTintColor: const WidgetStatePropertyAll(Colors.transparent),
        padding: const WidgetStatePropertyAll(
          EdgeInsets.symmetric(vertical: 4),
        ),
        shape: WidgetStatePropertyAll(
          RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(8),
            side: BorderSide(color: scheme.outlineVariant),
          ),
        ),
      ),
      menuChildren: [
        for (final entry in items)
          if (entry is AppMenuDivider<T>)
            const Divider(height: 9)
          else if (entry is AppMenuItem<T>)
            MenuItemButton(
              onPressed: () => onSelected(entry.value),
              leadingIcon: entry.checked
                  ? Icon(Icons.check, size: 16, color: scheme.primary)
                  : (entry.icon == null
                        ? const SizedBox(width: 16)
                        : Icon(entry.icon, size: 16)),
              style: MenuItemButton.styleFrom(
                minimumSize: const Size(0, 34),
                padding: const EdgeInsets.symmetric(horizontal: 12),
                foregroundColor: entry.danger ? scheme.error : scheme.onSurface,
                textStyle: text.bodyMedium,
              ),
              child: Text(entry.label),
            ),
      ],
      builder: (context, controller, child) {
        final opener = GestureDetector(
          onTap: () =>
              controller.isOpen ? controller.close() : controller.open(),
          child: child,
        );
        return tooltip == null
            ? opener
            : Tooltip(message: tooltip!, child: opener);
      },
      child: child,
    );
  }
}
