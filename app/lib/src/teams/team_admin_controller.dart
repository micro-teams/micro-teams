/// Everything you do TO a team, as opposed to everything you do inside one.
///
/// Kept apart from `common/team_scope.dart` on purpose. That file answers "which teams am I in and
/// which one am I looking at", which every feature needs; this one is the management surface, which
/// only this feature needs. Putting them together would have made a rename force a refetch of the
/// scope every other screen is watching.
///
/// Every mutation refreshes the two things it can have changed — the roster, and the team list the
/// rest of the app reads — rather than editing a local copy. A local edit that disagrees with the
/// server is a screen that lies until you leave it.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mt_api/mt_api.dart';

import '../common/mt_client.dart';
import '../common/team_scope.dart';
import '../providers.dart';

/// A team's roster.
class TeamRosterController extends FamilyAsyncNotifier<List<TeamMember>, int> {
  @override
  Future<List<TeamMember>> build(int arg) async {
    final response = await mtCall(
      ref.watch(mtClientProvider).team.listTeamMembers(id: arg),
    );
    return response.data ?? const <TeamMember>[];
  }
}

final teamRosterProvider =
    AsyncNotifierProvider.family<TeamRosterController, List<TeamMember>, int>(
      TeamRosterController.new,
    );

/// The actions. Not a Notifier: none of these hold state, they change the server's and then say
/// which questions need asking again.
class TeamAdmin {
  const TeamAdmin(this._ref);

  final Ref _ref;

  MtClient get _client => _ref.read(mtClientProvider);

  Future<Team?> create(String name) async {
    final response = await mtCall(
      _client.team.createTeam(createTeamRequest: CreateTeamRequest(name: name)),
    );
    _ref.invalidate(teamsProvider);
    return response.data;
  }

  Future<void> rename(int teamId, String name) async {
    await mtCall(
      _client.team.renameTeam(
        id: teamId,
        renameTeamRequest: RenameTeamRequest(name: name),
      ),
    );
    _ref.invalidate(teamsProvider);
  }

  /// Deleting a team also clears the selection when it was the selected one.
  ///
  /// Otherwise the app keeps asking the server about a team that no longer exists, and every screen
  /// scoped to it shows an error nobody can act on.
  Future<void> delete(int teamId) async {
    await mtCall(_client.team.deleteTeam(id: teamId));
    if (_ref.read(selectedTeamProvider) == teamId) {
      _ref.read(selectedTeamProvider.notifier).select(null);
    }
    _ref.invalidate(teamsProvider);
  }

  /// Somebody joins as a plain member. Promoting is a separate, deliberate act — a screen that
  /// let you add an owner in one step makes handing over a team a slip rather than a decision.
  Future<void> addMember(int teamId, int userId) async {
    await mtCall(
      _client.team.addTeamMember(
        id: teamId,
        addTeamMemberRequest: AddTeamMemberRequest(
          userId: userId,
          role: AddTeamMemberRequestRoleEnum.MEMBER,
        ),
      ),
    );
    _ref.invalidate(teamRosterProvider(teamId));
  }

  Future<void> removeMember(int teamId, int userId) async {
    await mtCall(_client.team.removeTeamMember(id: teamId, userId: userId));
    _ref.invalidate(teamRosterProvider(teamId));
  }

  Future<void> setRole(
    int teamId,
    int userId,
    ChangeRoleRequestRoleEnum role,
  ) async {
    await mtCall(
      _client.team.changeMemberRole(
        id: teamId,
        userId: userId,
        changeRoleRequest: ChangeRoleRequest(role: role),
      ),
    );
    _ref.invalidate(teamRosterProvider(teamId));
  }
}

final teamAdminProvider = Provider<TeamAdmin>(TeamAdmin.new);
