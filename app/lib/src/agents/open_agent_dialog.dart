/// The "open an agent" form.
///
/// Pick a machine that serves this team, optionally name it, and say which driver and where it
/// should work. The driver list and the default come from the server (`/agent/drivers`), because
/// which drivers exist is a property of the deployment: a client with its own list offers one the
/// server cannot run and hides one it can.
///
/// Nothing here is hidden behind an "advanced" disclosure. It was, in the React client, and the
/// two fields behind it — driver and working directory — turned out to be the two people actually
/// wanted to set (T-018). What is optional is said in the placeholder instead: every empty field
/// means "let the server decide", and the server's decision is what the placeholder previews.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mt_api/mt_api.dart';

import '../common/team_scope.dart';
import 'agents_controller.dart';

/// Shows the form. Returns the opened agent, or null if it was dismissed.
Future<OpenedAgent?> showOpenAgentDialog(
  BuildContext context, {
  required List<Machine> machines,
}) => showDialog<OpenedAgent>(
  context: context,
  builder: (context) => OpenAgentDialog(machines: machines),
);

class OpenAgentDialog extends ConsumerStatefulWidget {
  const OpenAgentDialog({required this.machines, super.key});

  final List<Machine> machines;

  @override
  ConsumerState<OpenAgentDialog> createState() => _OpenAgentDialogState();
}

class _OpenAgentDialogState extends ConsumerState<OpenAgentDialog> {
  final _nickname = TextEditingController();
  final _cwd = TextEditingController();
  String? _machineId;
  String? _driver;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    // The one machine, or the first connected one: a picker whose first choice is offline is a
    // form that fails on submit for a reason it could have known before you pressed anything.
    final online = widget.machines.where((m) => m.online);
    _machineId =
        (online.isNotEmpty ? online.first : widget.machines.firstOrNull)?.id;
    // Retyping the name into the placeholder as you go: the working directory the server will pick
    // is derived from the nickname, so this shows what it will be before you commit to it.
    _nickname.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _nickname.dispose();
    _cwd.dispose();
    super.dispose();
  }

  /// What the server would use if `cwd` is left empty.
  ///
  /// Mirrors `AgentService.defaultWorkCwd`'s slug. The server appends a per-agent suffix, so this
  /// is a preview rather than a promise — which is exactly what a placeholder is for.
  String get _cwdPlaceholder {
    final slug = _nickname.text
        .trim()
        .toLowerCase()
        .replaceAll(RegExp('[^a-z0-9]+'), '-')
        .replaceAll(RegExp('^-+|-+\$'), '');
    final name = slug.isEmpty
        ? 'agent'
        : slug.substring(0, slug.length.clamp(0, 40));
    return '~/.local/share/microteams/agents/$name';
  }

  Future<void> _submit() async {
    final machineId = _machineId;
    final team = ref.read(currentTeamProvider);
    if (machineId == null || team == null) {
      setState(() => _error = 'pick a machine to run the agent on');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final opened = await ref
          .read(agentsProvider.notifier)
          .open(
            machineId: machineId,
            teamId: team.id,
            nickname: _nickname.text,
            driver: _driver,
            cwd: _cwd.text,
          );
      if (mounted) Navigator.pop(context, opened);
    } catch (e) {
      // The server's own words: "machine is not connected", "machine not associated with team".
      // Those are the answers, and rewording them here would only make them vaguer.
      if (mounted) {
        setState(() {
          _busy = false;
          _error = '$e';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final drivers = ref.watch(driversProvider).value;
    final driver = _driver ?? drivers?.defaultDriver;

    return AlertDialog(
      title: const Text('Open agent'),
      content: SizedBox(
        width: 380,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (widget.machines.isEmpty)
                const Text(
                  'No machine serves this team yet. Add a device first.',
                )
              else
                DropdownButtonFormField<String>(
                  initialValue: _machineId,
                  decoration: const InputDecoration(labelText: 'Machine'),
                  items: [
                    for (final machine in widget.machines)
                      DropdownMenuItem(
                        value: machine.id,
                        // Said here rather than found out on submit: an agent cannot open on a
                        // machine whose connector is not running.
                        child: Text(
                          machine.online
                              ? machine.name
                              : '${machine.name} (not connected)',
                        ),
                      ),
                  ],
                  onChanged: (id) => setState(() => _machineId = id),
                ),
              const SizedBox(height: 12),
              TextField(
                controller: _nickname,
                decoration: const InputDecoration(
                  labelText: 'Name',
                  hintText: 'the server names it if you do not',
                ),
              ),
              const SizedBox(height: 12),
              if (drivers != null)
                DropdownButtonFormField<String>(
                  initialValue: driver,
                  decoration: const InputDecoration(labelText: 'Driver'),
                  items: [
                    for (final name in drivers.drivers)
                      DropdownMenuItem(
                        value: name,
                        child: Text(
                          name == drivers.defaultDriver
                              ? '$name (default)'
                              : name,
                        ),
                      ),
                  ],
                  onChanged: (name) => setState(() => _driver = name),
                ),
              const SizedBox(height: 12),
              TextField(
                controller: _cwd,
                decoration: InputDecoration(
                  labelText: 'Working directory',
                  hintText: _cwdPlaceholder,
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
      ),
      actions: [
        TextButton(
          onPressed: _busy ? null : () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _busy || widget.machines.isEmpty ? null : _submit,
          child: _busy
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Text('Open'),
        ),
      ],
    );
  }
}
