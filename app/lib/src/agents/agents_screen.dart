/// The agents and machines of the team you are looking at.
///
/// One screen for both layouts, as everywhere else here. The only thing the caller supplies is
/// what tapping a row means, because that is the only thing that genuinely differs between a
/// phone (push a screen) and a wide window (change what is beside the list).
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mt_api/mt_api.dart';

import '../common/ui/avatar.dart';
import '../common/ui/team_picker.dart';
import 'add_device_dialog.dart';
import 'agent_detail.dart';
import 'agents_controller.dart';
import 'machine_detail.dart';
import 'open_agent_dialog.dart';

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
        actions: [
          IconButton(
            tooltip: 'Add a device',
            onPressed: () => showAddDeviceDialog(context),
            icon: const Icon(Icons.devices_other),
          ),
          IconButton(
            tooltip: 'Open agent',
            onPressed: () => showOpenAgentDialog(
              context,
              machines: fleet.valueOrNull?.machines ?? const [],
            ),
            icon: const Icon(Icons.smart_toy_outlined),
          ),
        ],
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

  void _say(BuildContext context, String message) {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (fleet.agents.isEmpty && fleet.machines.isEmpty) {
      // An empty list with no way out of it is a dead end. The way in is here, and it is the one
      // that has to happen first: an agent runs ON something.
      return ListView(
        children: [
          const SizedBox(height: 80),
          const Center(child: Text('No machines or agents in this team yet')),
          const SizedBox(height: 16),
          Center(
            child: FilledButton.icon(
              onPressed: () => showAddDeviceDialog(context),
              icon: const Icon(Icons.devices_other),
              label: const Text('Add a device'),
            ),
          ),
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
            // The row opens the agent; every per-agent action lives in there. A row full of icon
            // buttons leaves no room for the name and has to be built twice, once per layout.
            onOpen: () => showAgentDetail(
              context,
              agent: agent,
              machineName: fleet.machineLabel(agent.machineId),
              actions: AgentActions(
                onWatch: agent.sid == null ? null : () => onOpenScreen(agent),
                onChat: () => _chat(context, ref, agent),
              ),
            ),
          ),
        if (fleet.machines.isNotEmpty) const _Heading('Machines'),
        for (final machine in fleet.machines)
          _MachineRow(
            machine: machine,
            onOpen: () => showMachineDetail(context, machine: machine),
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
    required this.onOpen,
  });

  final Agent agent;
  final String? machine;

  /// Null when this agent has no live screen to watch, which is why tapping the avatar does
  /// nothing rather than opening an empty terminal.
  final VoidCallback? onWatch;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final subtitle = [
      if (machine != null) machine!,
      if (agent.driver != null) agent.driver!,
    ].join(' · ');

    return ListTile(
      // The same avatar control as everywhere else, with the agent's real picture and the robot
      // badge — a coloured dot said less, and said it in a shape nothing else in the app uses.
      leading: Stack(
        clipBehavior: Clip.none,
        children: [
          UserAvatar(
            userId: agent.userId,
            nickname: agent.nickname,
            avatarId: agent.avatarId,
            size: 44,
            isAgent: true,
            onTap: onWatch,
          ),
          Positioned(right: -2, top: -2, child: _Dot(online: agent.online)),
        ],
      ),
      title: Text(
        agent.nickname.isEmpty ? 'agent #${agent.userId}' : agent.nickname,
      ),
      subtitle: subtitle.isEmpty ? null : Text(subtitle),
      onTap: onOpen,
    );
  }
}

class _MachineRow extends StatelessWidget {
  const _MachineRow({required this.machine, required this.onOpen});

  final Machine machine;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return ListTile(
      // The same 44px leading tile as an agent row, so the machine's status dot lands at the same
      // x as the agent's and the two lists read as one column of live/dead.
      leading: Stack(
        clipBehavior: Clip.none,
        children: [
          Container(
            width: 44,
            height: 44,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: scheme.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(Icons.dns_outlined, color: scheme.onSurfaceVariant),
          ),
          Positioned(right: -2, top: -2, child: _Dot(online: machine.online)),
        ],
      ),
      title: Text(machine.name),
      subtitle: Text(machine.online ? 'connected' : 'not connected'),
      onTap: onOpen,
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
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: online ? Colors.green : scheme.outlineVariant,
        // Ringed in the page's own colour so the dot reads as ON the tile rather than beside it,
        // whatever picture is underneath.
        border: Border.all(color: scheme.surface, width: 2),
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
