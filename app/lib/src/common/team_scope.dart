/// The teams you are in, and which one you are looking at.
///
/// The selected team is a piece of state the whole app reads and almost nothing writes, so it
/// lives here rather than being threaded through screens. It survives a restart: coming back to
/// the app and finding a different team selected than the one you left is the kind of small
/// betrayal that makes software feel unreliable.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mt_api/mt_api.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../providers.dart';

const String _selectedTeamKey = 'microteams.teamId';

/// The request whose answer seeds the team list on a cold start.
///
/// Written out because the cache is keyed by the REQUEST rather than by a name a screen chose —
/// which is what stops two screens caching the same data under two names. `cached_reads_test.dart`
/// makes the real call against a fake and reads it back, so this cannot drift.
const int _teamsPageSize = 100;
const String teamsPath = '/mt/team?page_size=$_teamsPageSize';

class TeamsController extends AsyncNotifier<List<Team>> {
  @override
  Future<List<Team>> build() async {
    final session = ref.watch(sessionProvider).value;
    if (session == null) return const [];

    final response = await ref
        .read(mtClientProvider)
        .team
        .listTeams(pageSize: _teamsPageSize);
    // Nothing is stored here: the client records every successful GET under the request's own key.
    return response.data?.teams ?? const <Team>[];
  }

  /// What the last run got for the same request, or nothing.
  List<Team> cached() {
    final body = ref
        .read(mtClientProvider)
        .cached<Map<String, Object?>>('GET', teamsPath);
    final raw = body?['teams'];
    if (raw is! List) return const [];
    return raw.whereType<Map<String, Object?>>().map(Team.fromJson).toList();
  }
}

final teamsProvider = AsyncNotifierProvider<TeamsController, List<Team>>(
  TeamsController.new,
);

/// Which team is being looked at.
///
/// Null means "not chosen yet", which is different from "there are none" — a screen that treats
/// them the same shows an empty state to someone whose teams simply have not arrived.
class SelectedTeam extends Notifier<int?> {
  @override
  int? build() {
    _restore();
    return null;
  }

  Future<void> _restore() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final saved = prefs.getInt(_selectedTeamKey);
      if (saved != null && state == null) state = saved;
    } catch (_) {
      // No storage is not a failure: the app just opens on the first team.
    }
  }

  void select(int? teamId) {
    state = teamId;
    unawaited(_persist(teamId));
  }

  Future<void> _persist(int? teamId) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      if (teamId == null) {
        await prefs.remove(_selectedTeamKey);
      } else {
        await prefs.setInt(_selectedTeamKey, teamId);
      }
    } catch (_) {
      // best effort
    }
  }
}

final selectedTeamProvider = NotifierProvider<SelectedTeam, int?>(
  SelectedTeam.new,
);

/// The team actually in view: the chosen one, or the first that exists.
///
/// Resolved in one place so no screen has to write "the selected team, or if that is null the
/// first one" — the sort of line that is written slightly differently in each place it appears.
final currentTeamProvider = Provider<Team?>((ref) {
  final teams = ref.watch(teamsProvider).value ?? const <Team>[];
  if (teams.isEmpty) return null;
  final selected = ref.watch(selectedTeamProvider);
  if (selected == null) return teams.first;
  for (final team in teams) {
    if (team.id == selected) return team;
  }
  // The selected team is gone — someone was removed from it, or it was deleted. Falling back
  // beats showing an empty screen that looks like a bug.
  return teams.first;
});

void unawaited(Future<void> future) {
  future.catchError((Object _) {});
}
