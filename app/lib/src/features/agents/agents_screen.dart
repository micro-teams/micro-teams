/// The agents and machines of the team you are looking at.
///
/// One screen for both layouts, as everywhere else here. The only thing the caller supplies is
/// what tapping a row means, because that is the only thing that genuinely differs between a
/// phone (push a screen) and a wide window (change what is beside the list).
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mt_api/mt_api.dart';

import '../teams/team_picker.dart';
import 'agents_controller.dart';

class AgentsScreen extends ConsumerWidget {
  const AgentsScreen({
    required this.onOpenScreen,
    required this.onOpenChat,
    super.key,
  });

  /// Watch this agent's live screen.
  final void Function(Agent agent) onOpenScreen;

  /// Go to the conversation with this agent.
  final void Function(int threadId) onOpenChat;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final fleet = ref.watch(agentsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Agents'),
        bottom: const TeamPickerBar(),
      ),
      body: fleet.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => _Failed(
          message: '$error',
          onRetry: () => ref.invalidate(agentsProvider),
        ),
        data: (data) => RefreshIndicator(
          onRefresh: () async => ref.invalidate(agentsProvider),
          child: _Fleet(
            fleet: data,
            onOpenScreen: onOpenScreen,
            onOpenChat: onOpenChat,
          ),
        ),
      ),
    );
  }
}

class _Fleet extends ConsumerWidget {
  const _Fleet({
    required this.fleet,
    required this.onOpenScreen,
    required this.onOpenChat,
  });

  final TeamFleet fleet;
  final void Function(Agent agent) onOpenScreen;
  final void Function(int threadId) onOpenChat;

  Future<void> _chat(BuildContext context, WidgetRef ref, Agent agent) async {
    try {
      final threadId = await ref.read(agentsProvider.notifier).startChat(agent);
      onOpenChat(threadId);
    } catch (e) {
      if (context.mounted) _say(context, '$e');
    }
  }

  Future<void> _close(BuildContext context, WidgetRef ref, Agent agent) async {
    final name = agent.nickname.isEmpty ? 'this agent' : agent.nickname;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Close $name?'),
        content: const Text(
          'Its session ends. Anything it was in the middle of stops there.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Close it'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await ref.read(agentsProvider.notifier).close(agent);
    } catch (e) {
      if (context.mounted) _say(context, '$e');
    }
  }

  Future<void> _unbind(
    BuildContext context,
    WidgetRef ref,
    Machine machine,
  ) async {
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
    } catch (e) {
      if (context.mounted) _say(context, '$e');
    }
  }

  void _say(BuildContext context, String message) {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (fleet.agents.isEmpty && fleet.machines.isEmpty) {
      return ListView(
        children: const [
          SizedBox(height: 80),
          Center(child: Text('No machines or agents in this team yet')),
        ],
      );
    }

    return ListView(
      children: [
        if (fleet.agents.isNotEmpty) const _Heading('Agents'),
        for (final agent in fleet.agents)
          _AgentRow(
            agent: agent,
            machine: fleet.machineLabel(agent.machineId),
            onWatch: agent.sid == null ? null : () => onOpenScreen(agent),
            onChat: () => _chat(context, ref, agent),
            onClose: () => _close(context, ref, agent),
          ),
        if (fleet.machines.isNotEmpty) const _Heading('Machines'),
        for (final machine in fleet.machines)
          _MachineRow(
            machine: machine,
            // Unbinding the LAST team orphans the machine and the backend forgets it outright, so
            // the action is absent — not disabled — while this team is the only one holding it.
            // An action that exists and refuses is an invitation to find out the hard way.
            onUnbind: machine.teamIds.length > 1
                ? () => _unbind(context, ref, machine)
                : null,
          ),
      ],
    );
  }
}

class _Heading extends StatelessWidget {
  const _Heading(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(16, 20, 16, 8),
    child: Text(text, style: Theme.of(context).textTheme.titleSmall),
  );
}

class _AgentRow extends StatelessWidget {
  const _AgentRow({
    required this.agent,
    required this.machine,
    required this.onWatch,
    required this.onChat,
    required this.onClose,
  });

  final Agent agent;
  final String? machine;

  /// Null when this agent has no live screen to watch, which is why the button is absent rather
  /// than present and disappointing.
  final VoidCallback? onWatch;
  final VoidCallback onChat;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    final subtitle = [
      if (machine != null) machine!,
      if (agent.driver != null) agent.driver!,
    ].join(' · ');

    return ListTile(
      leading: _Dot(online: agent.online),
      title: Text(
        agent.nickname.isEmpty ? 'agent #${agent.userId}' : agent.nickname,
      ),
      subtitle: subtitle.isEmpty ? null : Text(subtitle),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (onWatch != null)
            IconButton(
              tooltip: 'Live screen',
              onPressed: onWatch,
              icon: const Icon(Icons.terminal),
            ),
          IconButton(
            tooltip: 'Chat',
            onPressed: onChat,
            icon: const Icon(Icons.chat_bubble_outline),
          ),
          IconButton(
            tooltip: 'Close session',
            onPressed: onClose,
            icon: const Icon(Icons.power_settings_new),
          ),
        ],
      ),
    );
  }
}

class _MachineRow extends StatelessWidget {
  const _MachineRow({required this.machine, required this.onUnbind});

  final Machine machine;

  /// Null while this team is the only one holding the machine — see the call site.
  final VoidCallback? onUnbind;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: _Dot(online: machine.online),
      title: Text(machine.name),
      subtitle: Text(machine.online ? 'connected' : 'not connected'),
      trailing: onUnbind == null
          ? null
          : IconButton(
              tooltip: 'Remove from this team',
              onPressed: onUnbind,
              icon: const Icon(Icons.link_off),
            ),
    );
  }
}

/// Online or not. One dot, drawn one way, so "connected" never means two different things on two
/// screens — the React client had this drift and had to be pulled back into line.
class _Dot extends StatelessWidget {
  const _Dot({required this.online});

  final bool online;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      width: 12,
      height: 12,
      margin: const EdgeInsets.only(top: 16),
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: online ? Colors.green : scheme.outlineVariant,
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
        Padding(
          padding: const EdgeInsets.all(24),
          child: Text(message, textAlign: TextAlign.center),
        ),
        FilledButton.tonal(onPressed: onRetry, child: const Text('Try again')),
      ],
    ),
  );
}
