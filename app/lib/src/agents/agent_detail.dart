/// One agent, and everything you do to it.
///
/// A sheet rather than a row full of icon buttons. The React phone list learned this the hard way:
/// per-agent actions spread across a row leave no room for the name, and the same actions then
/// have to be built a second time for the wide layout. Here the row is the agent and this is what
/// it opens, on every size of screen.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mt_api/mt_api.dart';

import '../common/ui/change_avatar.dart';
import 'agents_controller.dart';

/// What the caller has to be able to do that this sheet cannot: leave for another screen.
class AgentActions {
  const AgentActions({required this.onWatch, required this.onChat});

  /// Null when the agent has no live screen — the button is absent rather than disappointing.
  final VoidCallback? onWatch;
  final VoidCallback onChat;
}

Future<void> showAgentDetail(
  BuildContext context, {
  required Agent agent,
  required String? machineName,
  required AgentActions actions,
}) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  showDragHandle: true,
  builder: (context) =>
      AgentDetail(agent: agent, machineName: machineName, actions: actions),
);

class AgentDetail extends ConsumerWidget {
  const AgentDetail({
    required this.agent,
    required this.machineName,
    required this.actions,
    super.key,
  });

  final Agent agent;
  final String? machineName;
  final AgentActions actions;

  String get _name =>
      agent.nickname.isEmpty ? 'agent #${agent.userId}' : agent.nickname;

  /// The agent as the list currently has it, so a rename or a new avatar shows here without
  /// closing the sheet. Falls back to what we were opened with while the list is refetching.
  Agent _live(WidgetRef ref) {
    final fleet = ref.watch(agentsProvider).value;
    for (final candidate in fleet?.agents ?? const <Agent>[]) {
      if (candidate.userId == agent.userId) return candidate;
    }
    return agent;
  }

  Future<void> _rename(BuildContext context, WidgetRef ref) async {
    final controller = TextEditingController(text: agent.nickname);
    final name = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Rename agent'),
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
      await ref.read(agentsProvider.notifier).rename(agent, name);
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }

  Future<void> _close(BuildContext context, WidgetRef ref) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Close $_name?'),
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

    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: ChangeAvatar(
                target: OtherAvatar(
                  userId: live.userId,
                  nickname: live.nickname,
                  avatarId: live.avatarId,
                  apply: (avatarId) => ref
                      .read(agentsProvider.notifier)
                      .setAvatar(live, avatarId),
                ),
              ),
            ),
            const SizedBox(height: 12),
            Center(
              child: Text(
                live.nickname.isEmpty ? 'agent #${live.userId}' : live.nickname,
                style: Theme.of(context).textTheme.titleMedium,
              ),
            ),
            Center(
              child: Text(
                live.online ? 'online' : 'offline',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ),
            const SizedBox(height: 16),
            _Row(label: 'user id', value: '${live.userId}'),
            if (live.driver != null) _Row(label: 'driver', value: live.driver!),
            if (machineName != null)
              _Row(label: 'machine', value: machineName!),
            const SizedBox(height: 8),
            _Keepalive(agent: live),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: () {
                Navigator.pop(context);
                actions.onChat();
              },
              icon: const Icon(Icons.chat_bubble_outline),
              label: const Text('Chat with agent'),
            ),
            if (actions.onWatch != null) ...[
              const SizedBox(height: 8),
              FilledButton.tonalIcon(
                onPressed: () {
                  Navigator.pop(context);
                  actions.onWatch!();
                },
                icon: const Icon(Icons.terminal),
                label: const Text('Live screen'),
              ),
            ],
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: () => _rename(context, ref),
              icon: const Icon(Icons.edit_outlined),
              label: const Text('Rename'),
            ),
            const SizedBox(height: 8),
            TextButton.icon(
              onPressed: () => _close(context, ref),
              style: TextButton.styleFrom(
                foregroundColor: Theme.of(context).colorScheme.error,
              ),
              icon: const Icon(Icons.power_settings_new),
              label: const Text('Close agent'),
            ),
          ],
        ),
      ),
    );
  }
}

/// The cache keepalive switch.
///
/// What it buys is not liveness — it is the driver's prefix cache not expiring, so an idle agent's
/// context never has to be rebuilt. A rebuild costs a large slice of the account's rolling quota,
/// which is why this is a switch a human gets to see rather than something always on.
class _Keepalive extends ConsumerWidget {
  const _Keepalive({required this.agent});

  final Agent agent;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final keepalive = agent.keepalive;
    final enabled = keepalive?.enabled ?? false;
    final minutes = ((keepalive?.intervalSeconds ?? 0) / 60).round();

    return SwitchListTile(
      contentPadding: EdgeInsets.zero,
      value: enabled,
      title: const Text('Keep its cache warm'),
      subtitle: Text(
        enabled && minutes > 0
            ? 'Every $minutes min, while its program is alive'
            : 'Stops an idle agent\'s context from having to be rebuilt',
      ),
      onChanged: (value) async {
        try {
          await ref
              .read(agentsProvider.notifier)
              .setKeepalive(agent, enabled: value);
        } catch (e) {
          if (context.mounted) {
            ScaffoldMessenger.of(
              context,
            ).showSnackBar(SnackBar(content: Text('$e')));
          }
        }
      },
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
