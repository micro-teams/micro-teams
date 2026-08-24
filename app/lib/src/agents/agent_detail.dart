/// One agent, and everything you do to it.
///
/// A place with a URL (`/agents/:userId`), which is what the React desktop did — selection lived in
/// the address bar so a deep link and the back button both worked. It is also why this is not a
/// bottom sheet any more: a sheet is not a frame on the display stack, so "back" had nothing to
/// pop and the wide layout had nowhere to put it. On a phone this is a pushed screen; beside a
/// list it is the pane on the right. One widget either way.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mt_api/mt_api.dart';

import '../common/ui/change_avatar.dart';
import '../common/ui/editable_name.dart';
import '../common/ui/online_dot.dart';
import 'agents_controller.dart';
import '../common/ui/app_dialog.dart';

/// What this screen cannot do for itself: leave for another one.
class AgentActions {
  const AgentActions({required this.onChat});

  final VoidCallback onChat;
}

/// The agent's own screen: this pushed onto the stack, with a header of its own.
class AgentDetailScreen extends ConsumerWidget {
  const AgentDetailScreen({
    required this.userId,
    required this.onChat,
    required this.onGone,
    this.asPane = false,
    super.key,
  });

  final int userId;
  final void Function(int threadId) onChat;

  /// The agent is no longer there — closed, or never was. The caller leaves this frame.
  final VoidCallback onGone;

  /// Beside the list rather than on top of it: no back arrow, because there is nothing to go back
  /// from — the list is still on screen.
  final bool asPane;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final fleet = ref.watch(agentsProvider).valueOrNull;
    Agent? agent;
    for (final candidate in fleet?.agents ?? const <Agent>[]) {
      if (candidate.userId == userId) agent = candidate;
    }

    if (agent == null) {
      return Scaffold(
        appBar: AppBar(automaticallyImplyLeading: !asPane),
        body: Center(
          child: fleet == null
              ? const CircularProgressIndicator()
              : const Text('that agent is not here any more'),
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: !asPane,
        title: Text(
          agent.nickname.isEmpty ? 'agent #${agent.userId}' : agent.nickname,
        ),
      ),
      body: AgentDetail(
        agent: agent,
        machineName: fleet?.machineLabel(agent.machineId),
        actions: AgentActions(onChat: () => _chat(context, ref, agent!)),
        onGone: onGone,
      ),
    );
  }

  Future<void> _chat(BuildContext context, WidgetRef ref, Agent agent) async {
    try {
      onChat(await ref.read(agentsProvider.notifier).startChat(agent));
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }
}

class AgentDetail extends ConsumerWidget {
  const AgentDetail({
    required this.agent,
    required this.machineName,
    required this.actions,
    required this.onGone,
    super.key,
  });

  final Agent agent;
  final String? machineName;
  final AgentActions actions;

  /// Called once this agent is closed, so whoever is showing it can leave.
  final VoidCallback onGone;

  String get _name =>
      agent.nickname.isEmpty ? 'agent #${agent.userId}' : agent.nickname;

  /// The agent as the list currently has it, so a rename or a new picture shows here without
  /// leaving. Falls back to what we were opened with while the list is refetching.
  Agent _live(WidgetRef ref) {
    final fleet = ref.watch(agentsProvider).valueOrNull;
    for (final candidate in fleet?.agents ?? const <Agent>[]) {
      if (candidate.userId == agent.userId) return candidate;
    }
    return agent;
  }

  Future<void> _close(BuildContext context, WidgetRef ref) async {
    final confirmed = await showAppDialog<bool>(
      context,
      builder: (context) => AlertDialog(
        title: Text('close $_name?'),
        content: const Text(
          'Its session ends. Anything it was in the middle of stops there.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('close it'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await ref.read(agentsProvider.notifier).close(agent);
      onGone();
    } catch (e) {
      if (context.mounted) _say(context, '$e');
    }
  }

  static void _say(BuildContext context, String message) =>
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(message)));

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final live = _live(ref);
    final scheme = Theme.of(context).colorScheme;

    // The React detail is a centred column in a reading-width card: a big avatar, the name, what it
    // is, and then the things you can do — in that order, because you look at this to find out
    // WHICH agent this is before you do anything to it.
    return ListView(
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
      children: [
        Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Center(
                  child: ChangeAvatar(
                    size: 96,
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
                const SizedBox(height: 16),
                // The name is edited where it is written — see ui/editable_name.dart.
                Center(
                  child: EditableName(
                    name: live.nickname.isEmpty
                        ? 'agent #${live.userId}'
                        : live.nickname,
                    onRename: (name) async {
                      try {
                        await ref
                            .read(agentsProvider.notifier)
                            .rename(live, name);
                      } catch (e) {
                        if (context.mounted) _say(context, '$e');
                      }
                    },
                  ),
                ),
                const SizedBox(height: 4),
                Center(child: OnlineDot(online: live.online)),
                const SizedBox(height: 20),
                Facts(
                  rows: [
                    (label: 'user id', value: '${live.userId}'),
                    if (live.driver != null)
                      (label: 'driver', value: live.driver!),
                    if (machineName != null)
                      (label: 'machine', value: machineName!),
                    if (live.teamId != null)
                      (label: 'team', value: '${live.teamId}'),
                  ],
                ),
                const SizedBox(height: 12),
                Center(
                  child: Text(
                    'tap the picture to change it · tap the face in a list to '
                    'watch its live screen',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                ),
                const SizedBox(height: 20),
                _Keepalive(agent: live),
                const SizedBox(height: 20),
                FilledButton.icon(
                  onPressed: actions.onChat,
                  icon: const Icon(Icons.chat_bubble_outline),
                  label: const Text('chat with agent'),
                ),
                const SizedBox(height: 8),
                TextButton.icon(
                  onPressed: () => _close(context, ref),
                  style: TextButton.styleFrom(foregroundColor: scheme.error),
                  icon: const Icon(Icons.power_settings_new),
                  label: const Text('close agent'),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

/// What something IS, as a bordered list of label/value rows — the React `dl`.
class Facts extends StatelessWidget {
  const Facts({required this.rows, super.key});

  final List<({String label, String value})> rows;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;

    // A table, so the values share one left edge.
    //
    // They used to be pushed to the right by a Spacer, which means every row's value started
    // wherever its own length put it — a column of text with a ragged left edge, which is the edge
    // the eye actually follows down a list of facts. An intrinsic first column makes the labels as
    // wide as the longest label and no wider, and everything after it lines up by construction
    // rather than by a number somebody guessed.
    return Container(
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLow,
        border: Border.all(color: scheme.outlineVariant),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Table(
        columnWidths: const {0: IntrinsicColumnWidth(), 1: FlexColumnWidth()},
        border: TableBorder(
          horizontalInside: BorderSide(color: scheme.outlineVariant),
        ),
        defaultVerticalAlignment: TableCellVerticalAlignment.baseline,
        textBaseline: TextBaseline.alphabetic,
        children: [
          for (final row in rows)
            TableRow(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
                  child: Text(
                    row.label,
                    style: text.bodyMedium?.copyWith(
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(0, 12, 16, 12),
                  child: Text(row.value, style: text.bodyMedium),
                ),
              ],
            ),
        ],
      ),
    );
  }
}

/// The cache keepalive switch, and how often it fires.
///
/// What it buys is not liveness — it is the driver's prefix cache not expiring, so an idle agent's
/// context never has to be rebuilt. A rebuild costs a large one-off slice of the account's rolling
/// quota, which is why this is a switch a human gets to see rather than something always on.
///
/// The interval is shown in minutes because the cache's TTL is about an hour, and stored in
/// seconds because that is what the server takes. It is deliberately unbounded: the operator knows
/// the TTL, and the TTL is not ours — it can move under us when the driver changes.
class _Keepalive extends ConsumerStatefulWidget {
  const _Keepalive({required this.agent});

  final Agent agent;

  @override
  ConsumerState<_Keepalive> createState() => _KeepaliveState();
}

class _KeepaliveState extends ConsumerState<_Keepalive> {
  /// What the React control defaulted to, and for the same reason: comfortably inside an hour.
  static const int _defaultMinutes = 40;

  late final TextEditingController _minutes = TextEditingController(
    text: '${_currentMinutes ?? _defaultMinutes}',
  );

  int? get _currentMinutes {
    final seconds = widget.agent.keepalive?.intervalSeconds;
    return seconds == null || seconds <= 0 ? null : (seconds / 60).round();
  }

  bool get _enabled => widget.agent.keepalive?.enabled ?? false;

  @override
  void didUpdateWidget(_Keepalive old) {
    super.didUpdateWidget(old);
    // A different agent is a different number. Keeping the field as it was would offer one agent's
    // interval as if it were another's, which is the kind of wrong that gets applied by accident.
    if (old.agent.userId != widget.agent.userId) {
      _minutes.text = '${_currentMinutes ?? _defaultMinutes}';
    }
  }

  @override
  void dispose() {
    _minutes.dispose();
    super.dispose();
  }

  Future<void> _apply({required bool enabled}) async {
    final minutes = int.tryParse(_minutes.text.trim());
    try {
      await ref
          .read(agentsProvider.notifier)
          .setKeepalive(
            widget.agent,
            enabled: enabled,
            intervalSeconds: enabled && minutes != null && minutes > 0
                ? minutes * 60
                : null,
          );
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final minutes = int.tryParse(_minutes.text.trim());
    final valid = minutes != null && minutes > 0;
    final changed = _enabled && valid && minutes != _currentMinutes;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          value: _enabled,
          title: const Text('Keep its cache warm'),
          subtitle: Text(
            _enabled && _currentMinutes != null
                ? 'Every $_currentMinutes min, while its program is alive'
                : "Stops an idle agent's context from having to be rebuilt",
          ),
          onChanged: (on) => _apply(enabled: on),
        ),
        if (_enabled)
          Row(
            children: [
              SizedBox(
                width: 120,
                child: TextField(
                  controller: _minutes,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    labelText: 'every',
                    suffixText: 'min',
                  ),
                  onChanged: (_) => setState(() {}),
                ),
              ),
              const SizedBox(width: 12),
              // Only offered once it would do something: a button that is always there and usually
              // a no-op teaches people to press it and see.
              if (changed)
                FilledButton.tonal(
                  onPressed: () => _apply(enabled: true),
                  child: const Text('apply'),
                ),
            ],
          ),
      ],
    );
  }
}
