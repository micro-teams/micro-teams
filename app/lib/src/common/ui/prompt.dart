/// One line of text, asked for in a dialog.
///
/// Shared rather than owned by teams, because renaming is not a teams idea: an agent, a machine, a
/// team and a document all have names somebody may change, and asking for one in four slightly
/// different ways is four things to keep consistent.
library;

import 'package:flutter/material.dart';

import 'app_dialog.dart';

/// Asks for one line of text and returns it, or null when the question was dismissed.
///
/// The controller belongs to a StatefulWidget rather than to this function, and that is not
/// tidiness: disposing it when `showDialog` returns disposes it while the dialog's exit animation
/// is still building the field, which throws "A TextEditingController was used after being
/// disposed" a frame later. A dialog is gone from the code long before it is gone from the screen.
Future<String?> promptForText(
  BuildContext context, {
  required String title,
  required String hint,
  required String action,
  String initial = '',
}) {
  return showAppDialog<String>(
    context,
    builder: (context) =>
        _TextPrompt(title: title, hint: hint, action: action, initial: initial),
  );
}

class _TextPrompt extends StatefulWidget {
  const _TextPrompt({
    required this.title,
    required this.hint,
    required this.action,
    required this.initial,
  });

  final String title;
  final String hint;
  final String action;
  final String initial;

  @override
  State<_TextPrompt> createState() => _TextPromptState();
}

class _TextPromptState extends State<_TextPrompt> {
  late final TextEditingController _controller = TextEditingController(
    text: widget.initial,
  );

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _submit() => Navigator.of(context).pop(_controller.text.trim());

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(widget.title),
      content: TextField(
        controller: _controller,
        autofocus: true,
        decoration: InputDecoration(hintText: widget.hint),
        onSubmitted: (_) => _submit(),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('cancel'),
        ),
        TextButton(onPressed: _submit, child: Text(widget.action)),
      ],
    );
  }
}
