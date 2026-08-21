/// One team: its name, who is in it, and what they may do.
///
/// The two destructive actions here ask first, and they ask differently. Removing a member is
/// reversible — add them back. Deleting a team is not, so it requires typing the team's name, the
/// way a repository host makes you: a confirmation you can dismiss by reflex is not a confirmation.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mt_api/mt_api.dart';

import '../common/team_scope.dart';
import '../common/ui/avatar.dart';
import '../common/ui/theme.dart';
import '../providers.dart';
import 'team_admin_controller.dart';
import 'teams_screen.dart' show promptForText;

class TeamScreen extends ConsumerWidget {
  const TeamScreen({required this.teamId, required this.onGone, super.key});

  final int teamId;

  /// Called once the team no longer exists, so the shell can leave a screen about nothing.
  final VoidCallback onGone;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final team = ref
        .watch(teamsProvider)
        .value
        ?.where((t) => t.id == teamId)
        .firstOrNull;
    final roster = ref.watch(teamRosterProvider(teamId));
    final me = ref.watch(sessionProvider).valueOrNull?.user.id;
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: Text(team?.name ?? 'team #$teamId'),
        actions: [
          IconButton(
            tooltip: 'rename',
            onPressed: team == null
                ? null
                : () => _rename(context, ref, team.name),
            icon: const Icon(Icons.edit_outlined),
          ),
          IconButton(
            tooltip: 'add member',
            onPressed: () => _addMember(context, ref),
            icon: const Icon(Icons.person_add_outlined),
          ),
        ],
      ),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: Metrics.readingColumn),
          child: roster.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (error, _) => Center(child: Text('$error')),
            data: (members) => ListView(
              children: [
                for (final member in members)
                  _MemberRow(
                    member: member,
                    isMe: member.userId == me,
                    onRole: (role) => ref
                        .read(teamAdminProvider)
                        .setRole(teamId, member.userId, role),
                    onRemove: () => _removeMember(context, ref, member),
                  ),
                const SizedBox(height: 24),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: SizedBox(
                    height: 44,
                    child: FilledButton(
                      style: FilledButton.styleFrom(
                        backgroundColor: scheme.error,
                        foregroundColor: Colors.white,
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      ),
                      onPressed: team == null
                          ? null
                          : () => _delete(context, ref, team.name),
                      child: const Text('delete this team'),
                    ),
                  ),
                ),
                const SizedBox(height: 24),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _rename(
    BuildContext context,
    WidgetRef ref,
    String current,
  ) async {
    final name = await promptForText(
      context,
      title: 'rename team',
      hint: 'name',
      action: 'rename',
      initial: current,
    );
    if (name == null || name.isEmpty || name == current) return;
    await ref.read(teamAdminProvider).rename(teamId, name);
  }

  Future<void> _addMember(BuildContext context, WidgetRef ref) async {
    // By user id, as the React client did. There is no user search in the contract, and inventing a
    // lookup here would mean guessing at an endpoint that does not exist.
    final raw = await promptForText(
      context,
      title: 'add member',
      hint: 'user id',
      action: 'add',
    );
    final userId = int.tryParse(raw ?? '');
    if (userId == null) return;
    await ref.read(teamAdminProvider).addMember(teamId, userId);
  }

  Future<void> _removeMember(
    BuildContext context,
    WidgetRef ref,
    TeamMember member,
  ) async {
    final name = member.nickname ?? 'user #${member.userId}';
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('remove $name?'),
        content: const Text('They can be added back afterwards.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('remove'),
          ),
        ],
      ),
    );
    if (confirmed ?? false) {
      await ref.read(teamAdminProvider).removeMember(teamId, member.userId);
    }
  }

  Future<void> _delete(BuildContext context, WidgetRef ref, String name) async {
    final typed = await promptForText(
      context,
      title: 'delete "$name"?',
      hint: 'type the team name to confirm',
      action: 'delete',
    );
    // Not a mistake to be dismissed: this is irreversible, and a dialog you can clear by reflex is
    // not a confirmation.
    if (typed != name) return;
    await ref.read(teamAdminProvider).delete(teamId);
    onGone();
  }
}

/// The one menu entry that is not a role. An object rather than a string so the menu can be typed
/// on the generated enum and still carry it.
const Object _remove = Object();

class _MemberRow extends StatelessWidget {
  const _MemberRow({
    required this.member,
    required this.isMe,
    required this.onRole,
    required this.onRemove,
  });

  final TeamMember member;
  final bool isMe;
  final void Function(ChangeRoleRequestRoleEnum) onRole;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final name = member.nickname ?? 'user #${member.userId}';
    return ListTile(
      leading: UserAvatar(
        userId: member.userId,
        nickname: member.nickname,
        size: Metrics.avatarInDenseList,
      ),
      title: Text(name),
      subtitle: Text(
        member.role.name.toLowerCase(),
        style: Theme.of(
          context,
        ).textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
      ),
      // Typed on the enum itself, not on 'role:NAME' strings: a role added, renamed or removed in
      // the contract has to break the build here rather than fall through a firstWhere at runtime.
      trailing: PopupMenuButton<Object>(
        // Your own row offers nothing: demoting or removing yourself out of a team you administer
        // is the one action with no way back from inside the app.
        enabled: !isMe,
        itemBuilder: (context) => [
          for (final role in ChangeRoleRequestRoleEnum.values)
            PopupMenuItem<Object>(
              value: role,
              child: Text('make ${role.name.toLowerCase()}'),
            ),
          const PopupMenuDivider(),
          PopupMenuItem<Object>(
            value: _remove,
            child: Text('remove', style: TextStyle(color: scheme.error)),
          ),
        ],
        onSelected: (choice) {
          if (choice == _remove) {
            onRemove();
            return;
          }
          onRole(choice as ChangeRoleRequestRoleEnum);
        },
      ),
    );
  }
}
