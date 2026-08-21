/// Which of these people are agents, and is anything watchable right now.
///
/// The React client asked this from one app-global provider that every avatar registered itself
/// with; the answer is what made an agent's avatar clickable and gave it a live screen. Without it
/// a conversation with an agent is a conversation with a picture — you can read what it said, and
/// there is no way to see what it is doing.
///
/// Keyed by the set of user ids being asked about, joined and sorted so that the same question is
/// the same provider. The agent enumeration only ever returns AGENTS, so being in the answer IS
/// being an agent; anyone missing from it is a human, which is why absence is meaningful here and
/// not just "not loaded yet".
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mt_api/mt_api.dart';

import '../providers.dart';
import 'mt_client.dart';
import 'updates/topics.dart';
import 'team_scope.dart';

class Presence {
  const Presence(this.byUserId);

  final Map<int, Agent> byUserId;

  Agent? operator [](int userId) => byUserId[userId];

  /// A live screen exists for this user right now. Both halves matter: an agent that is offline
  /// has no session to attach to, and one that has never had a session has no id to attach with.
  bool watchable(int userId) {
    final agent = byUserId[userId];
    return agent != null && agent.online && (agent.sid?.isNotEmpty ?? false);
  }

  String? sidFor(int userId) => byUserId[userId]?.sid;
}

/// The ids, as a provider key. A list is not a usable family argument — two equal lists are not
/// `==` — so this is the canonical string form.
String presenceKey(Iterable<int> userIds) {
  final ids = userIds.toSet().toList()..sort();
  return ids.join(',');
}

class PresenceController extends FamilyAsyncNotifier<Presence, String> {
  @override
  Future<Presence> build(String arg) async {
    if (arg.isEmpty) return const Presence({});
    final ids = arg.split(',').map(int.parse).toList();

    // An agent goes busy, idle, offline out of band. The team topic is what says so.
    final team = ref.watch(currentTeamProvider);
    if (team != null) {
      watchTopic(
        ref,
        teamTopic(team.id),
        onChange: (_) => ref.invalidateSelf(),
      );
    }

    final response = await mtCall(
      ref.watch(mtClientProvider).agent.listAgents(userId: ids),
    );
    return Presence({
      for (final agent in response.data?.agents ?? const <Agent>[])
        agent.userId: agent,
    });
  }
}

final presenceProvider =
    AsyncNotifierProvider.family<PresenceController, Presence, String>(
      PresenceController.new,
    );
