/// A team's machines and the agents running on them, plus the things you do to them.
///
/// One question, one place. In the React client both shells fetched both lists, polled both on
/// their own timer, and each implemented close, unbind and "start a chat with this agent"
/// separately — the lists are the same question either way, only the arrangement differs.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mt_api/mt_api.dart';

import '../providers.dart';
import '../common/updates/topics.dart';
import '../common/team_scope.dart';

class TeamFleet {
  const TeamFleet({this.machines = const [], this.agents = const []});

  final List<Machine> machines;
  final List<Agent> agents;

  /// The machine's NAME for an agent, rather than its opaque id. Falls back to the id when the
  /// machine is not in the list — which happens while it is still loading, and would otherwise
  /// render as a blank where a name belongs.
  String? machineLabel(String? machineId) {
    if (machineId == null || machineId.isEmpty) return null;
    for (final machine in machines) {
      if (machine.id == machineId) return machine.name;
    }
    return machineId;
  }
}

class AgentsController extends AsyncNotifier<TeamFleet> {
  @override
  Future<TeamFleet> build() async {
    final team = ref.watch(currentTeamProvider);
    if (team == null) return const TeamFleet();

    // Was a 4s poll on both lists. Agents open, go busy and close out of band, and machines come
    // and go — all of which the server already knows the moment it happens, so it says so.
    watchTopic(
      ref,
      teamTopic(team.id),
      onChange: (_) => ref.invalidateSelf(),
      // Mirrors TeamQuery.digest: machines, how many are connected, how many agents.
      //
      // It deliberately leaves out whether each agent's program is alive. The server and this list
      // mean slightly different things by "online", and checking one against the other would raise
      // false alarms forever. Liveness still arrives as an event; it is just not what gets
      // verified.
      digest: () {
        final fleet = state.value;
        if (fleet == null) return null;
        final online = fleet.machines.where((m) => m.online == true).length;
        return '${fleet.machines.length}:$online:${fleet.agents.length}';
      },
    );

    final client = ref.read(mtClientProvider);
    // Both lists answer one question about one team, so they are asked together rather than by two
    // screens that each think they own half of it.
    final responses = await Future.wait([
      client.machine.listMachines(teamId: team.id, pageSize: 100),
      client.agent.listAgents(teamId: team.id, pageSize: 100),
    ]);

    final machines =
        (responses[0].data as ListMachinesResponse?)?.machines ??
        const <Machine>[];
    final agents =
        (responses[1].data as ListAgentsResponse?)?.agents ?? const <Agent>[];

    return TeamFleet(machines: machines, agents: agents);
  }

  /// Close an agent's session. Confirming with the human belongs to the caller.
  Future<void> close(Agent agent) async {
    await ref.read(mtClientProvider).agent.closeAgent(userId: agent.userId);
    ref.invalidateSelf();
  }

  /// Stop this team using a machine.
  ///
  /// Unbinding the LAST team orphans the machine and the backend then forgets it outright, so the
  /// surfaces only offer this while the machine serves more than one team. That guard is theirs to
  /// render; this is only the call.
  Future<void> unbind(Machine machine) async {
    final team = ref.read(currentTeamProvider);
    if (team == null) return;
    await ref
        .read(mtClientProvider)
        .team
        .unbindTeamMachine(id: team.id, machineId: machine.id);
    ref.invalidateSelf();
  }

  /// Open — or find — the conversation with this agent, and return the thread to go to.
  ///
  /// Reusing the existing 1:1 is what stops repeated taps from piling up duplicate conversations.
  /// "The 1:1 with this agent" is a chat the caller is in whose only two members are the caller and
  /// this agent: listChats returns only the caller's chats, so a two-member chat containing the
  /// agent can only be that pair.
  Future<int> startChat(Agent agent) async {
    final client = ref.read(mtClientProvider);
    final chats =
        (await client.chat.listChats(pageSize: 100)).data?.chats ??
        const <ChatSummary>[];

    for (final chat in chats) {
      if (chat.members.length != 2) continue;
      if (chat.members.any((m) => m.userId == agent.userId)) return chat.id;
    }

    final created = await client.chat.createThread(
      createThreadRequest: CreateThreadRequest(
        title: agent.nickname.isEmpty
            ? 'agent #${agent.userId}'
            : agent.nickname,
        memberIds: [agent.userId],
      ),
    );
    final thread = created.data;
    if (thread == null) {
      throw StateError(
        'the server created a conversation but did not say which',
      );
    }
    return thread.id;
  }
}

final agentsProvider = AsyncNotifierProvider<AgentsController, TeamFleet>(
  AgentsController.new,
);
