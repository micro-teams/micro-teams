/// One machine: what it is called, whether it is connected, who is running on it, and the two
/// things you can do to it from here — rename it, or stop this team using it.
///
/// The name is a label, not an identifier: the id is what everything else refers to, so renaming
/// is free and is the only way a fleet of hosts stays readable (T-032).
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mt_api/mt_api.dart';

import 'agents_controller.dart';

Future<void> showMachineDetail(
  BuildContext context, {
  required Machine machine,
}) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  showDragHandle: true,
  builder: (context) => MachineDetail(machine: machine),
);

class MachineDetail extends ConsumerWidget {
  const MachineDetail({required this.machine, super.key});

  final Machine machine;

  /// The machine as the list currently has it, so a rename shows without closing the sheet.
  Machine _live(WidgetRef ref) {
    final fleet = ref.watch(agentsProvider).value;
    for (final candidate in fleet?.machines ?? const <Machine>[]) {
      if (candidate.id == machine.id) return candidate;
    }
    return machine;
  }

  Future<void> _rename(BuildContext context, WidgetRef ref) async {
    final controller = TextEditingController(text: machine.name);
    final name = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Rename machine'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(labelText: 'Name'),
          onSubmitted: (value) => Navigator.pop(context, value),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text),
            child: const Text('Rename'),
          ),
        ],
      ),
    );
    if (name == null || name.trim().isEmpty) return;
    try {
      await ref.read(agentsProvider.notifier).renameMachine(machine, name);
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }

  Future<void> _unbind(BuildContext context, WidgetRef ref) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Remove ${machine.name} from this team?'),
        content: const Text('Other teams keep it. This team stops seeing it.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await ref.read(agentsProvider.notifier).unbind(machine);
      if (context.mounted) Navigator.pop(context);
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final live = _live(ref);
    final fleet = ref.watch(agentsProvider).value;
    final here = (fleet?.agents ?? const <Agent>[])
        .where((a) => a.machineId == live.id)
        .toList();

    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: Text(
                live.name,
                style: Theme.of(context).textTheme.titleMedium,
              ),
            ),
            Center(
              child: Text(
                live.online ? 'connected' : 'not connected',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ),
            const SizedBox(height: 16),
            _Row(label: 'id', value: live.id),
            _Row(label: 'teams', value: '${live.teamIds.length}'),
            _Row(
              label: 'agents here',
              value: here.isEmpty
                  ? 'none'
                  : here
                        .map(
                          (a) => a.nickname.isEmpty
                              ? 'agent #${a.userId}'
                              : a.nickname,
                        )
                        .join(', '),
            ),
            const SizedBox(height: 16),
            OutlinedButton.icon(
              onPressed: () => _rename(context, ref),
              icon: const Icon(Icons.edit_outlined),
              label: const Text('Rename'),
            ),
            // Unbinding the LAST team orphans the machine and the backend forgets it outright, so
            // the action is absent — not disabled — while this team is the only one holding it. An
            // action that exists and refuses is an invitation to find out the hard way.
            if (live.teamIds.length > 1) ...[
              const SizedBox(height: 8),
              TextButton.icon(
                onPressed: () => _unbind(context, ref),
                style: TextButton.styleFrom(
                  foregroundColor: Theme.of(context).colorScheme.error,
                ),
                icon: const Icon(Icons.link_off),
                label: const Text('Remove from this team'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _Row extends StatelessWidget {
  const _Row({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 6),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 96,
          child: Text(label, style: Theme.of(context).textTheme.bodySmall),
        ),
        Expanded(child: Text(value)),
      ],
    ),
  );
}
