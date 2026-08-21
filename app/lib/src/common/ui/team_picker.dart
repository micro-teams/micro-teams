/// Which team you are looking at, as an action in the page header.
///
/// One widget, used by every screen that is scoped to a team, so switching teams means the same
/// thing and looks the same everywhere. In the header's top-right rather than a strip under it
/// (T-007): a whole bar for one word costs a row of vertical space on every scoped screen, and on a
/// phone that row is the one the list wanted.
///
/// It also carries the way into team management, because managing teams is what you came to the
/// team picker for when the team you want is not in the list yet. That is where the React client
/// put it too — team management was never a destination of its own, it was reached from here.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../team_scope.dart';

class TeamPickerAction extends ConsumerWidget {
  const TeamPickerAction({required this.onManage, super.key});

  /// Go to team management. Supplied by the caller because navigation is the shell's business.
  final VoidCallback onManage;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final teams = ref.watch(teamsProvider).value ?? const [];
    final current = ref.watch(currentTeamProvider);
    final scheme = Theme.of(context).colorScheme;

    return Padding(
      padding: const EdgeInsets.only(right: 4),
      child: PopupMenuButton<int>(
        tooltip: 'Team',
        onSelected: (id) {
          if (id == _manage) {
            onManage();
            return;
          }
          ref.read(selectedTeamProvider.notifier).select(id);
        },
        itemBuilder: (context) => [
          for (final team in teams)
            CheckedPopupMenuItem(
              value: team.id,
              checked: team.id == current?.id,
              child: Text(team.name),
            ),
          if (teams.isNotEmpty) const PopupMenuDivider(),
          const PopupMenuItem(value: _manage, child: Text('manage teams')),
        ],
        child: Container(
          constraints: const BoxConstraints(maxWidth: 160),
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: BoxDecoration(
            color: scheme.surfaceContainerHighest,
            borderRadius: BorderRadius.circular(8),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Flexible(
                child: Text(
                  current?.name ?? 'team',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.labelLarge,
                ),
              ),
              const Icon(Icons.expand_more, size: 16),
            ],
          ),
        ),
      ),
    );
  }
}

/// Not a team id. Ids are positive, so a negative value cannot collide with one.
const int _manage = -1;
