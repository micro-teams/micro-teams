/// A name you can change where it is written.
///
/// Tap the pencil and the name becomes a field with a tick beside it; press the tick (or Enter) and
/// it is saved. There is no dialog, and that is the point: a dialog for a name covers the thing
/// being named, has to be dismissed to see the result, and — as this app learned twice — is a frame
/// somebody's back gesture will look for and not find, closing the screen underneath instead.
///
/// One control, used wherever something has a name a human may change: an agent, a machine, and
/// whatever comes next.
library;

import 'package:flutter/material.dart';

class EditableName extends StatefulWidget {
  const EditableName({
    required this.name,
    required this.onRename,
    this.style,
    super.key,
  });

  final String name;

  /// Saves. Failures are the caller's to report — it knows what it was renaming.
  final Future<void> Function(String name) onRename;

  final TextStyle? style;

  @override
  State<EditableName> createState() => _EditableNameState();
}

class _EditableNameState extends State<EditableName> {
  final _controller = TextEditingController();
  bool _editing = false;
  bool _saving = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _start() {
    setState(() {
      _editing = true;
      _controller.text = widget.name;
    });
  }

  Future<void> _save() async {
    final name = _controller.text.trim();
    if (name.isEmpty || name == widget.name) {
      setState(() => _editing = false);
      return;
    }
    setState(() => _saving = true);
    try {
      await widget.onRename(name);
    } finally {
      if (mounted) {
        setState(() {
          _saving = false;
          _editing = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final style = widget.style ?? Theme.of(context).textTheme.titleMedium;

    if (!_editing) {
      return Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Flexible(child: Text(widget.name, style: style)),
          IconButton(
            tooltip: 'rename',
            visualDensity: VisualDensity.compact,
            onPressed: _start,
            icon: const Icon(Icons.edit_outlined, size: 18),
          ),
        ],
      );
    }

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        SizedBox(
          width: 200,
          child: TextField(
            controller: _controller,
            autofocus: true,
            style: style,
            decoration: const InputDecoration(isDense: true),
            onSubmitted: (_) => _save(),
          ),
        ),
        IconButton(
          tooltip: 'save',
          visualDensity: VisualDensity.compact,
          onPressed: _saving ? null : _save,
          icon: _saving
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.check, size: 18),
        ),
      ],
    );
  }
}
