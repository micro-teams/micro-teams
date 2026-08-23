/// One machine: what it is called, whether it is connected, who is running on it, and the two
/// things you can do to it from here — rename it, or stop this team using it.
///
/// A frame on the display stack with a URL of its own (`/agents/machine/:id`), not a sheet: back
/// pops it, a link opens it, and beside a list it is simply the right-hand pane.
///
/// The name is a label, not an identifier: the id is what everything else refers to, so renaming
/// is free and is the only way a fleet of hosts stays readable (T-032).
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mt_api/mt_api.dart';

import '../common/team_scope.dart';
import '../common/ui/avatar.dart';
import '../common/ui/editable_name.dart';
import '../common/ui/online_dot.dart';
import 'agent_detail.dart' show Facts;
import 'agents_controller.dart';
import '../common/ui/app_dialog.dart';
import '../common/ui/section_action.dart';

/// The machine's own screen: a frame on the stack, like the agent's.
class MachineDetailScreen extends ConsumerWidget {
  const MachineDetailScreen({
    required this.machineId,
    required this.onGone,
    this.onOpenAgent,
    this.asPane = false,
    super.key,
  });

  final String machineId;
  final VoidCallback onGone;

  /// Open one of the agents running here — the machine's list of them is a way in, not a display.
  final void Function(Agent agent)? onOpenAgent;
  final bool asPane;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final fleet = ref.watch(agentsProvider).valueOrNull;
    Machine? machine;
    for (final candidate in fleet?.machines ?? const <Machine>[]) {
      if (candidate.id == machineId) machine = candidate;
    }

    if (machine == null) {
      return Scaffold(
        appBar: AppBar(automaticallyImplyLeading: !asPane),
        body: Center(
          child: fleet == null
              ? const CircularProgressIndicator()
              : const Text('that machine is not in this team any more'),
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: !asPane,
        title: Text(machine.name),
      ),
      body: MachineDetail(
        machine: machine,
        onGone: onGone,
        onOpenAgent: onOpenAgent,
      ),
    );
  }
}

class MachineDetail extends ConsumerWidget {
  const MachineDetail({
    required this.machine,
    required this.onGone,
    this.onOpenAgent,
    super.key,
  });

  final Machine machine;

  /// Called once this team no longer has the machine, so whoever is showing it can leave.
  final VoidCallback onGone;

  /// Open one of the agents running here. Null where there is nowhere to open it.
  final void Function(Agent agent)? onOpenAgent;

  Machine _live(WidgetRef ref) {
    final fleet = ref.watch(agentsProvider).valueOrNull;
    for (final candidate in fleet?.machines ?? const <Machine>[]) {
      if (candidate.id == machine.id) return candidate;
    }
    return machine;
  }

  static void _say(BuildContext context, String message) =>
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(message)));

  Future<void> _guard(
    BuildContext context,
    Future<void> Function() action,
  ) async {
    try {
      await action();
    } catch (e) {
      if (context.mounted) _say(context, '$e');
    }
  }

  Future<void> _unbind(BuildContext context, WidgetRef ref, int teamId) async {
    final confirmed = await showAppDialog<bool>(
      context,
      builder: (context) => AlertDialog(
        title: Text('stop using ${machine.name} in this team?'),
        content: const Text('Other teams keep it.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('remove'),
          ),
        ],
      ),
    );
    if (confirmed != true || !context.mounted) return;
    await _guard(context, () async {
      await ref.read(agentsProvider.notifier).unbind(machine);
      onGone();
    });
  }

  Future<void> _forget(BuildContext context, WidgetRef ref) async {
    final confirmed = await showAppDialog<bool>(
      context,
      builder: (context) => AlertDialog(
        title: Text('de-register ${machine.name}?'),
        content: const Text(
          'It is forgotten for every team it serves, not just this one. The '
          'host keeps its connector installed and would have to enrol again.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('de-register'),
          ),
        ],
      ),
    );
    if (confirmed != true || !context.mounted) return;
    await _guard(context, () async {
      await ref.read(agentsProvider.notifier).forget(machine);
      onGone();
    });
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final live = _live(ref);
    final scheme = Theme.of(context).colorScheme;
    final fleet = ref.watch(agentsProvider).valueOrNull;
    final here = (fleet?.agents ?? const <Agent>[])
        .where((a) => a.machineId == live.id)
        .toList();
    final teams = ref.watch(teamsProvider).valueOrNull ?? const <Team>[];
    final current = ref.watch(currentTeamProvider);
    final elsewhere = teams.where((t) => !live.teamIds.contains(t.id)).toList();

    return ListView(
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 24),
      children: [
        Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 520),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Center(
                  child: Container(
                    width: 64,
                    height: 64,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: scheme.surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Icon(
                      Icons.dns_outlined,
                      size: 32,
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                Center(
                  child: EditableName(
                    name: live.name,
                    onRename: (name) => _guard(
                      context,
                      () => ref
                          .read(agentsProvider.notifier)
                          .renameMachine(live, name),
                    ),
                  ),
                ),
                const SizedBox(height: 4),
                Center(child: OnlineDot(online: live.online)),
                const SizedBox(height: 20),
                Facts(
                  rows: [
                    (label: 'machine id', value: live.id),
                    if (live.createdAt != null)
                      (label: 'enrolled', value: _when(live.createdAt!)),
                    (
                      label: 'status',
                      value: live.online ? 'connected' : 'not connected',
                    ),
                  ],
                ),
                const SizedBox(height: 24),
                _SectionHeader(
                  title:
                      'serves ${live.teamIds.length} '
                      '${live.teamIds.length == 1 ? 'team' : 'teams'}',
                  action: elsewhere.isEmpty
                      ? null
                      : PopupMenuButton<int>(
                          tooltip: 'add to team',
                          onSelected: (teamId) => _guard(
                            context,
                            () => ref
                                .read(agentsProvider.notifier)
                                .bind(live.id, teamId: teamId),
                          ),
                          itemBuilder: (context) => [
                            for (final team in elsewhere)
                              PopupMenuItem(
                                value: team.id,
                                child: Text(team.name),
                              ),
                          ],
                          child: const SectionActionLabel('add to team'),
                        ),
                ),
                _Bordered(
                  children: [
                    for (final id in live.teamIds)
                      ListTile(
                        dense: true,
                        // A machine may serve teams you are not in. Those have no name to show, and
                        // inventing one would be worse than saying which id it is.
                        title: Text(
                          teams
                                  .where((t) => t.id == id)
                                  .map((t) => t.name)
                                  .firstOrNull ??
                              'team #$id',
                        ),
                        subtitle: id == current?.id
                            ? const Text('this team')
                            : null,
                        trailing: id == current?.id && live.teamIds.length > 1
                            ? IconButton(
                                tooltip: 'remove from this team',
                                onPressed: () => _unbind(context, ref, id),
                                icon: const Icon(Icons.close, size: 18),
                              )
                            : null,
                      ),
                  ],
                ),
                const SizedBox(height: 24),
                const _SectionHeader(title: 'agents on this machine'),
                if (here.isEmpty)
                  _Bordered(
                    children: [
                      const ListTile(
                        dense: true,
                        title: Text('none in this team right now'),
                      ),
                    ],
                  )
                else
                  _Bordered(
                    children: [
                      for (final agent in here)
                        ListTile(
                          dense: true,
                          leading: UserAvatar(
                            userId: agent.userId,
                            nickname: agent.nickname,
                            avatarId: agent.avatarId,
                            size: 32,
                            clickable: false,
                          ),
                          title: Text(
                            agent.nickname.isEmpty
                                ? 'agent #${agent.userId}'
                                : agent.nickname,
                          ),
                          trailing: OnlineDot(
                            online: agent.online,
                            showLabel: false,
                          ),
                          onTap: onOpenAgent == null
                              ? null
                              : () => onOpenAgent!(agent),
                        ),
                    ],
                  ),
                const SizedBox(height: 24),
                // De-registering is not "remove from this team" with a bigger blast radius: it
                // forgets the machine everywhere, and the host would have to enrol again. It gets
                // its own fenced-off corner for the same reason it does in the React client.
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    border: Border.all(
                      color: scheme.error.withValues(alpha: 0.4),
                    ),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        'danger zone',
                        style: Theme.of(
                          context,
                        ).textTheme.labelSmall?.copyWith(color: scheme.error),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'De-registering forgets this machine for every team it '
                        'serves, not just this one.',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      const SizedBox(height: 8),
                      TextButton(
                        onPressed: () => _forget(context, ref),
                        style: TextButton.styleFrom(
                          foregroundColor: scheme.error,
                        ),
                        child: const Text('de-register this machine'),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  static String _when(DateTime at) {
    final local = at.toLocal();
    String two(int n) => n.toString().padLeft(2, '0');
    return '${local.year}-${two(local.month)}-${two(local.day)}';
  }
}

/// A section's title, with whatever action belongs to that section beside it.
class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title, this.action});

  final String title;
  final Widget? action;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: Row(
      children: [
        Text(
          title,
          style: Theme.of(context).textTheme.labelMedium?.copyWith(
            color: Theme.of(context).colorScheme.onSurfaceVariant,
          ),
        ),
        const Spacer(),
        if (action != null) action!,
      ],
    ),
  );
}

/// The bordered, divided list the React client used for every group of rows.
class _Bordered extends StatelessWidget {
  const _Bordered({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      decoration: BoxDecoration(
        border: Border.all(color: scheme.outlineVariant),
        borderRadius: BorderRadius.circular(8),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          for (final (index, child) in children.indexed) ...[
            if (index > 0) Divider(height: 1, color: scheme.outlineVariant),
            child,
          ],
        ],
      ),
    );
  }
}
