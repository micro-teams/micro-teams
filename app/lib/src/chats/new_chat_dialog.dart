/// Starting a conversation.
///
/// Two fields, because that is what the server needs: a title, and optionally who else is in it.
/// Member ids rather than a people-picker is what the React client did too, and it is honest about
/// what exists — there is no user search endpoint. Ids can be added later from the chat's own info
/// screen, so an empty second field is a normal way to start.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'chats_controller.dart';
import '../common/ui/app_dialog.dart';

/// Shows the form. Returns the new thread's id, or null if it was dismissed.
Future<int?> showNewChatDialog(BuildContext context) =>
    showAppDialog<int>(context, builder: (context) => const NewChatDialog());

/// "12, 34 56" as ids. Anything that is not a number is dropped rather than refused: the field
/// accepts what someone pasted, and a stray comma is not an error worth stopping for.
List<int> parseMemberIds(String raw) => raw
    .split(RegExp(r'[\s,]+'))
    .map((piece) => int.tryParse(piece.trim()))
    .whereType<int>()
    .toList();

class NewChatDialog extends ConsumerStatefulWidget {
  const NewChatDialog({super.key});

  @override
  ConsumerState<NewChatDialog> createState() => _NewChatDialogState();
}

class _NewChatDialogState extends ConsumerState<NewChatDialog> {
  final _title = TextEditingController();
  final _members = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _title.dispose();
    _members.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_title.text.trim().isEmpty) {
      setState(() => _error = 'give it a title');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final thread = await ref
          .read(chatsProvider.notifier)
          .create(title: _title.text, memberIds: parseMemberIds(_members.text));
      if (mounted) Navigator.pop(context, thread.id);
    } catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = '$e';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('New chat'),
    content: SizedBox(
      width: 360,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            controller: _title,
            autofocus: true,
            decoration: const InputDecoration(
              labelText: 'Title',
              hintText: 'general',
            ),
            onSubmitted: (_) => _submit(),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _members,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(
              labelText: 'Member ids (optional)',
              hintText: '12, 34, 56',
              helperText: 'comma or space separated user ids',
            ),
          ),
          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(
              _error!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ],
        ],
      ),
    ),
    actions: [
      TextButton(
        onPressed: _busy ? null : () => Navigator.pop(context),
        child: const Text('Cancel'),
      ),
      FilledButton(
        onPressed: _busy ? null : _submit,
        child: _busy
            ? const SizedBox(
                width: 16,
                height: 16,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : const Text('Create'),
      ),
    ],
  );
}
