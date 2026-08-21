/// The teams you are in, and the way to make another.
///
/// One responsive screen, as everywhere else: the list is the same list at any width, and the only
/// thing a wide window changes is how much of it fits. There is no desktop copy of this file.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mt_api/mt_api.dart';

import '../common/team_scope.dart';
import '../common/ui/theme.dart';
import 'team_admin_controller.dart';

class TeamsScreen extends ConsumerWidget {
  const TeamsScreen({
    required this.onOpen,
    this.selectedId,
    this.dense = false,
    super.key,
  });

  final void Function(Team team) onOpen;

  /// Which team the detail beside this list is about — whatever the URL says is open.
  final int? selectedId;

  /// Beside a detail pane the list is the narrower variant, as the chat and agent lists are.
  final bool dense;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final teams = ref.watch(teamsProvider);
    final selected = ref.watch(selectedTeamProvider);
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        // The list is not something you go back FROM; it is always there.
        automaticallyImplyLeading: false,
        title: const Text('teams'),
        actions: [
          IconButton(
            tooltip: 'new team',
            onPressed: () => _createTeam(context, ref),
            icon: const Icon(Icons.add),
          ),
        ],
      ),
      body: Center(
        child: ConstrainedBox(
          constraints: BoxConstraints(
            maxWidth: dense ? double.infinity : Metrics.readingColumn,
          ),
          child: teams.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (error, _) => _Failed(
              message: '$error',
              onRetry: () => ref.invalidate(teamsProvider),
            ),
            data: (list) => list.isEmpty
                ? const _Empty()
                : ListView.builder(
                    itemCount: list.length,
                    itemBuilder: (context, index) {
                      final team = list[index];
                      return ListTile(
                        title: Text(team.name),
                        subtitle: Text(
                          'team #${team.id}',
                          style: Theme.of(context).textTheme.bodySmall
                              ?.copyWith(color: scheme.onSurfaceVariant),
                        ),
                        // The selected team is marked rather than merely remembered: every other
                        // screen is scoped to it, so "which one am I in" has to be answerable here.
                        trailing: team.id == selected
                            ? Icon(Icons.check, color: scheme.primary)
                            : null,
                        // Open and selected are two different things: the row you are LOOKING at
                        // is not necessarily the team the rest of the app is scoped to. The tick
                        // says which team you are in; this says which one is on the right.
                        selected: team.id == selectedId,
                        onTap: () {
                          ref
                              .read(selectedTeamProvider.notifier)
                              .select(team.id);
                          onOpen(team);
                        },
                      );
                    },
                  ),
          ),
        ),
      ),
    );
  }

  Future<void> _createTeam(BuildContext context, WidgetRef ref) async {
    final name = await promptForText(
      context,
      title: 'new team',
      hint: 'name',
      action: 'create',
    );
    if (name == null || name.isEmpty) return;
    final team = await ref.read(teamAdminProvider).create(name);
    // Made and then not selected is a team you have to go and find; making one is a statement of
    // where you intend to work.
    if (team != null) {
      ref.read(selectedTeamProvider.notifier).select(team.id);
    }
  }
}

/// One line of text, asked for in a dialog. Used by every rename and create in this feature.
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
  return showDialog<String>(
    context: context,
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

class _Empty extends StatelessWidget {
  const _Empty();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.groups_outlined, size: 32, color: scheme.onSurfaceVariant),
          const SizedBox(height: 8),
          Text(
            'no teams yet — use + to make one',
            style: Theme.of(
              context,
            ).textTheme.bodyMedium?.copyWith(color: scheme.onSurfaceVariant),
          ),
        ],
      ),
    );
  }
}

class _Failed extends StatelessWidget {
  const _Failed({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Center(
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(message, textAlign: TextAlign.center),
        const SizedBox(height: 12),
        FilledButton.tonal(onPressed: onRetry, child: const Text('try again')),
      ],
    ),
  );
}
