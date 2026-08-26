/// App-global agent presence: which of these people are agents, and what each one is doing.
///
/// Every avatar tracks its own user id here and the registry batches every tracked id into ONE
/// request, so an avatar anywhere in the app becomes agent-aware — the ring, the status, the live
/// screen's sid — from a single shared fetch. That is how the React client did it
/// (`useAgentPresence`), and the shape matters: per-avatar fetching would put a request behind
/// every face in a chat list.
///
/// The fetch is `GET /agent?userId=…`, the one agent enumeration, filtered. Only agents come back,
/// so "is this user an agent?" is simply whether the id is in the answer, and the server attaches
/// `sid` only for an agent this viewer is allowed to watch.
///
/// Nothing polls. Liveness arrives on the team topic — an agent dying or coming back is something
/// the server knows the instant it happens — and a newly tracked id refetches because the tracked
/// set changed, which is strictly more responsive than any tick.
library;

import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mt_api/mt_api.dart';

import '../providers.dart';
import 'team_scope.dart';
import 'updates/topics.dart';

class Presence {
  const Presence(this.byUserId);

  final Map<int, Agent> byUserId;

  Agent? operator [](int userId) => byUserId[userId];

  /// Only agents are enumerated, so being in the answer IS being an agent.
  bool isAgent(int userId) => byUserId.containsKey(userId);

  /// A live screen exists for this user right now. Both halves matter: an agent that is offline
  /// has no session to attach to, and one that has never had a session has no id to attach with.
  bool watchable(int userId) {
    final agent = byUserId[userId];
    return agent != null && agent.online && (agent.sid?.isNotEmpty ?? false);
  }

  String? sidFor(int userId) => byUserId[userId]?.sid;
}

/// What an agent's `vars` say it is doing, as far as an avatar cares.
///
/// The three working states are the React client's (`isAgentWorking`): busy, starting, compacting.
/// Anything else — idle, unknown, absent — is not working, and an avatar that pulsed for those
/// would be an app that always looks busy.
bool isWorking(Agent? agent) {
  final status = agent?.vars?['status'];
  return status == 'busy' || status == 'starting' || status == 'compacting';
}

class AgentPresence extends Notifier<Presence> {
  @override
  Presence build() {
    // An agent goes busy, idle, offline out of band. The team topic is what says so.
    final team = ref.watch(currentTeamProvider);
    if (team != null) {
      watchTopic(ref, teamTopic(team.id), onChange: (_) => _refresh());
    }
    ref.onDispose(() => _debounce?.cancel());
    // A rebuild — which is what the team arriving looks like — cancels whatever was waiting to be
    // asked. So anything already being watched is asked again here, or a refresh scheduled in the
    // same instant the team lands is simply lost. That instant is the app's first second, when
    // every avatar on screen is mounting at once.
    if (_tracked.isNotEmpty) _schedule();
    // Empty on purpose: a rebuild means the team changed, and what is known about one team's
    // agents says nothing about another's. The refresh scheduled above fills it in again.
    return const Presence({});
  }

  /// How many avatars are asking about each id. Counted rather than a set, because the same person
  /// appears in a list row and in the bubble beside it, and one of them unmounting must not stop
  /// the other from being told.
  final Map<int, int> _tracked = {};
  Timer? _debounce;
  bool _inFlight = false;

  /// Something happened while a request was in flight that the request did not cover: more ids were
  /// tracked, or the request failed. Without this the question was simply DROPPED — see [_refresh].
  bool _askAgain = false;

  void track(int userId) {
    if (userId == 0) return;
    final had = _tracked.containsKey(userId);
    _tracked[userId] = (_tracked[userId] ?? 0) + 1;
    // Only a change in WHICH ids are tracked is worth a request; avatars mount constantly.
    if (!had) _schedule();
  }

  void untrack(int userId) {
    final left = (_tracked[userId] ?? 0) - 1;
    if (left <= 0) {
      _tracked.remove(userId);
    } else {
      _tracked[userId] = left;
    }
  }

  /// One frame's worth of coalescing. A list paints thirty avatars in one frame, and each of them
  /// tracking would otherwise be thirty requests for the same answer.
  void _schedule([Duration after = const Duration(milliseconds: 16)]) {
    _debounce?.cancel();
    _debounce = Timer(after, _refresh);
  }

  /// How long to wait before asking again after a failed attempt. Long enough not to hammer a
  /// server that is having a bad moment, short enough that an avatar is clickable before anybody
  /// has finished reading the row it is in.
  static const Duration _afterFailure = Duration(seconds: 2);

  Future<void> _refresh() async {
    if (_tracked.isEmpty) return;
    // A second question while the first is in the air used to be dropped and never asked again,
    // and this is the app's startup in one sentence: the first few avatars send a request, thirty
    // more mount while it is out, and every one of those ids is dropped. Nothing tries later —
    // only a CHANGE in the tracked set schedules a request — so those faces stay "not an agent"
    // for as long as the screen is open: the ring never appears, and tapping one does nothing at
    // all, because an avatar that is not known to be an agent has no tap handler.
    if (_inFlight) {
      _askAgain = true;
      return;
    }
    _inFlight = true;
    var failed = false;
    try {
      final ids = _tracked.keys.toList();
      final response = await ref
          .read(mtClientProvider)
          .agent
          .listAgents(userId: ids);
      final agents = response.data?.agents ?? const <Agent>[];
      // Merged, not replaced: a request asks about the ids tracked when it left, and a list that
      // scrolled in the meantime would otherwise lose the faces it just learned about.
      state = Presence({
        ...state.byUserId,
        for (final agent in agents) agent.userId: agent,
      });
    } catch (_) {
      // Presence is decoration. A failure here means no ring and no live screen for a moment; it
      // must never be able to take a screen down with it — but it must not be the LAST word
      // either, or one unlucky moment at startup leaves every agent looking like a person.
      failed = true;
    } finally {
      _inFlight = false;
    }
    if (failed || _askAgain) {
      _askAgain = false;
      _schedule(failed ? _afterFailure : const Duration(milliseconds: 16));
    }
  }
}

final agentPresenceProvider = NotifierProvider<AgentPresence, Presence>(
  AgentPresence.new,
);
