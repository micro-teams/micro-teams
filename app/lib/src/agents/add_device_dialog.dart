/// "Add a device" — the one place a machine joins this team, by either of the two ways there are.
///
/// Enrolling a NEW host is not something a client can do: it happens on that machine, through the
/// CLI. So that half is a tutorial — the two commands to run, copyable — and the link the CLI
/// prints opens `/connect`, which is where a human lands either way.
///
/// Reusing a machine you ALREADY have is the other half. It used to be a second button beside this
/// one in the React client, which read as two different intentions; it is one intention — "let this
/// team run agents somewhere" — so it is one dialog, offered first because it is the cheaper path,
/// and absent when there is nothing to reuse.
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mt_api/mt_api.dart';

import '../common/team_scope.dart';
import '../providers.dart';
import 'agents_controller.dart';

Future<void> showAddDeviceDialog(BuildContext context) => showDialog<void>(
  context: context,
  builder: (context) => const AddDeviceDialog(),
);

class AddDeviceDialog extends ConsumerWidget {
  const AddDeviceDialog({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final origin = ref.watch(endpointsProvider).origin;
    final team = ref.watch(currentTeamProvider);
    final mine =
        ref.watch(allMachinesProvider).valueOrNull ?? const <Machine>[];
    // Only the ones this team is not already using — the others are not an option, they are the
    // list you were just looking at.
    final spare = team == null
        ? const <Machine>[]
        : mine.where((m) => !m.teamIds.contains(team.id)).toList();

    return AlertDialog(
      title: const Text('Add a device'),
      content: SizedBox(
        width: 420,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (spare.isNotEmpty) ...[
                Text(
                  'A machine you already have',
                  style: Theme.of(context).textTheme.titleSmall,
                ),
                const SizedBox(height: 8),
                for (final machine in spare)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(machine.name),
                    subtitle: Text(
                      machine.online ? 'connected' : 'not connected',
                    ),
                    trailing: FilledButton.tonal(
                      onPressed: () async {
                        await ref
                            .read(agentsProvider.notifier)
                            .bind(machine.id);
                        if (context.mounted) Navigator.pop(context);
                      },
                      child: const Text('Add'),
                    ),
                  ),
                const Divider(height: 32),
              ],
              Text(
                'A new machine',
                style: Theme.of(context).textTheme.titleSmall,
              ),
              const SizedBox(height: 8),
              const Text(
                'Run these on the machine you want agents to work on:',
              ),
              const SizedBox(height: 8),
              _Command('curl -fsSL $origin/install.sh | sh'),
              const SizedBox(height: 4),
              const Text(
                'Installs the connector and a private tmux for it to run in.',
                style: TextStyle(fontSize: 12),
              ),
              const SizedBox(height: 12),
              const _Command('microteams link auto-connect'),
              const SizedBox(height: 4),
              const Text(
                'Prints a link. Open it here, choose which teams the machine '
                'should serve, and approve.',
                style: TextStyle(fontSize: 12),
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Done'),
        ),
      ],
    );
  }
}

/// A command, and a button that copies exactly it.
class _Command extends StatefulWidget {
  const _Command(this.text);

  final String text;

  @override
  State<_Command> createState() => _CommandState();
}

class _CommandState extends State<_Command> {
  bool _copied = false;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: [
          Expanded(
            child: SelectableText(
              widget.text,
              style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
            ),
          ),
          IconButton(
            tooltip: 'Copy',
            icon: Icon(_copied ? Icons.check : Icons.copy, size: 18),
            onPressed: () async {
              await Clipboard.setData(ClipboardData(text: widget.text));
              if (!mounted) return;
              setState(() => _copied = true);
              await Future<void>.delayed(const Duration(milliseconds: 1500));
              if (mounted) setState(() => _copied = false);
            },
          ),
        ],
      ),
    );
  }
}
