/// Which team you are looking at, as a strip under an app bar.
///
/// One widget, used by every screen that is scoped to a team, so switching teams means the same
/// thing and looks the same everywhere. It renders nothing at all when there is only one team:
/// a chooser with one choice is furniture.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../team_scope.dart';

class TeamPickerBar extends ConsumerWidget implements PreferredSizeWidget {
  const TeamPickerBar({super.key});

  @override
  Size get preferredSize => const Size.fromHeight(48);

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final teams = ref.watch(teamsProvider).valueOrNull ?? const [];
    final current = ref.watch(currentTeamProvider);

    if (teams.length < 2 || current == null) return const SizedBox.shrink();

    return SizedBox(
      height: 48,
      child: Align(
        alignment: Alignment.centerLeft,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: DropdownButtonHideUnderline(
            child: DropdownButton<int>(
              value: current.id,
              onChanged: (id) =>
                  ref.read(selectedTeamProvider.notifier).select(id),
              items: [
                for (final team in teams)
                  DropdownMenuItem(value: team.id, child: Text(team.name)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
