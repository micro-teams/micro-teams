/// A name, with the way to change it beside it.
///
/// The change happens in a dialog. That was not always true here — for a while it was edited in
/// place, on the grounds that a dialog covers the thing being named — and the real objection turned
/// out to be different: a dialog pushed outside the router was a frame the back gesture went
/// looking for and did not find, so back closed the screen underneath instead. That is fixed where
/// it belonged, in ui/app_dialog.dart, and a dialog is now an ordinary frame on the display stack.
///
/// One control, used wherever something has a name a human may change: an agent, a machine, and
/// whatever comes next.
library;

import 'package:flutter/material.dart';

import 'prompt.dart';

class EditableName extends StatelessWidget {
  const EditableName({
    required this.name,
    required this.onRename,
    this.title,
    this.style,
    super.key,
  });

  final String name;

  /// Saves. Failures are the caller's to report — it knows what it was renaming.
  final Future<void> Function(String name) onRename;

  /// What the dialog is called. Defaults to renaming whatever [name] currently is.
  final String? title;

  final TextStyle? style;

  Future<void> _edit(BuildContext context) async {
    final next = await promptForText(
      context,
      title: title ?? 'rename $name',
      hint: 'name',
      action: 'rename',
      initial: name,
    );
    // Dismissed, or handed back the name it already had: neither is a change to save.
    if (next == null || next.trim().isEmpty || next.trim() == name) return;
    await onRename(next.trim());
  }

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      Flexible(
        child: Text(
          name,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: style ?? Theme.of(context).textTheme.titleMedium,
        ),
      ),
      const SizedBox(width: 4),
      IconButton(
        tooltip: 'rename',
        visualDensity: VisualDensity.compact,
        onPressed: () => _edit(context),
        icon: const Icon(Icons.edit_outlined, size: 16),
      ),
    ],
  );
}
