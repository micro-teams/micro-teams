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
import '../common/ui/online_dot.dart';
import '../common/ui/theme.dart';
import '../common/ui/team_picker.dart';
import 'add_device_dialog.dart';
import 'agents_controller.dart';
import 'open_agent_dialog.dart';
import '../common/ui/section_action.dart';

class AgentsScreen extends ConsumerWidget {
  const AgentsScreen({
    required this.onOpenAgent,
    required this.onOpenMachine,
    required this.onManageTeams,
    this.selectedAgentId,
    this.selectedMachineId,
    super.key,
  });

  /// Go to team management, from the team picker in the header.
  final VoidCallback onManageTeams;

  /// Open this agent — a pushed frame on a phone, the pane beside the list on a wide window.
  final void Function(Agent agent) onOpenAgent;

  final void Function(Machine machine) onOpenMachine;

  /// What the list draws as selected, which is whatever the URL says is open.
  final int? selectedAgentId;
  final String? selectedMachineId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final fleet = ref.watch(agentsProvider);

    return Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: false,
        title: const Text('agents'),
        // The two "make something" buttons are NOT here. They sit on the section they make
        // something in — see the headings below, which is where the React client put them: an
        // "open agent" button in the corner of a page belongs to the page, and this page has two
        // lists that each grow a different way.
        actions: [TeamPickerAction(onManage: onManageTeams)],
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
            onOpenAgent: onOpenAgent,
            onOpenMachine: onOpenMachine,
            selectedAgentId: selectedAgentId,
            selectedMachineId: selectedMachineId,
          ),
        ),
      ),
    );
  }
}

class _Fleet extends ConsumerWidget {
  const _Fleet({
    required this.fleet,
    required this.onOpenAgent,
    required this.onOpenMachine,
    required this.selectedAgentId,
    required this.selectedMachineId,
  });

  final TeamFleet fleet;
  final void Function(Agent agent) onOpenAgent;
  final void Function(Machine machine) onOpenMachine;
  final int? selectedAgentId;
  final String? selectedMachineId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // No special "everything is empty" screen: both sections say what they are for and carry the
    // button that fills them, so an empty page is the same page with empty sections. A separate
    // empty state is a second layout to keep in step with the first.
    return ListView(
      children: [
        _Heading(
          'machines',
          key: const ValueKey('section-machines'),
          action: SectionAction(
            label: 'add device',
            onPressed: () => showAddDeviceDialog(context),
          ),
        ),
        for (final machine in fleet.machines)
          _MachineRow(
            machine: machine,
            onOpen: () => onOpenMachine(machine),
            selected: machine.id == selectedMachineId,
          ),
        if (fleet.machines.isEmpty)
          const _Empty(
            'no machines serve this team. Use "add device" — either enrol a new '
            'host, or add one you already have.',
          ),
        _Heading(
          'agents',
          key: const ValueKey('section-agents'),
          action: SectionAction(
            label: 'open agent',
            onPressed: () =>
                showOpenAgentDialog(context, machines: fleet.machines),
          ),
        ),
        for (final agent in fleet.agents)
          _AgentRow(
            agent: agent,
            machine: fleet.machineLabel(agent.machineId),
            // The row opens the agent, and every per-agent action lives in there. A row full of
            // icon buttons leaves no room for the name and has to be built twice, once per layout.
            onOpen: () => onOpenAgent(agent),
            selected: agent.userId == selectedAgentId,
          ),
        if (fleet.agents.isEmpty) const _Empty('no agents running — open one'),
      ],
    );
  }
}

/// A section's name, with the button that adds to THAT section beside it.
class _Heading extends StatelessWidget {
  const _Heading(this.text, {this.action, super.key});

  final String text;
  final Widget? action;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(16, 20, 8, 8),
    child: Row(
      children: [
        Text(
          text,
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

/// What a section says when it has nothing in it — in a dashed box, so an empty section reads as
/// empty rather than as still loading.
class _Empty extends StatelessWidget {
  const _Empty(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
    child: Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        border: Border.all(
          color: Theme.of(context).colorScheme.outlineVariant,
          style: BorderStyle.solid,
        ),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(text, style: Theme.of(context).textTheme.bodySmall),
    ),
  );
}

class _AgentRow extends StatelessWidget {
  const _AgentRow({
    required this.agent,
    required this.machine,
    required this.onOpen,
    required this.selected,
  });

  final Agent agent;
  final String? machine;
  final VoidCallback onOpen;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    final subtitle = [
      if (machine != null) machine!,
      if (agent.driver != null) agent.driver!,
    ].join(' · ');

    return ListTile(
      // Just the avatar. It is agent-aware on its own — the ring while it works, the tap that
      // opens its live screen — and the React row put liveness in the meta line below rather than
      // as a badge on the face.
      leading: UserAvatar(
        userId: agent.userId,
        nickname: agent.nickname,
        avatarId: agent.avatarId,
        size: 44,
      ),
      title: Text(
        agent.nickname.isEmpty ? 'agent #${agent.userId}' : agent.nickname,
      ),
      subtitle: Row(
        children: [
          OnlineDot(online: agent.online),
          if (subtitle.isNotEmpty) ...[
            const SizedBox(width: 6),
            Flexible(
              child: Text(
                subtitle,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ],
      ),
      onTap: onOpen,
      selected: selected,
    );
  }
}

class _MachineRow extends StatelessWidget {
  const _MachineRow({
    required this.machine,
    required this.onOpen,
    required this.selected,
  });

  final Machine machine;
  final VoidCallback onOpen;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return ListTile(
      // The same 44px leading tile as an agent row, so the two lists read as one column.
      leading: Container(
        width: 44,
        height: 44,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: scheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(Metrics.avatarRadius),
        ),
        child: Icon(Icons.dns_outlined, color: scheme.onSurfaceVariant),
      ),
      title: Text(machine.name),
      subtitle: OnlineDot(online: machine.online),
      onTap: onOpen,
      selected: selected,
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
