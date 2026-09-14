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

  /// Open an agent on a machine.
  ///
  /// Every field except the machine is optional and the SERVER decides the default — the nickname,
  /// the working directory, and which driver. A client that invents its own defaults disagrees with
  /// the server the day either changes, and the disagreement shows up as an agent that ran
  /// somewhere nobody expected.
  Future<OpenedAgent> open({
    required String machineId,
    required int teamId,
    String? nickname,
    String? driver,
    String? cwd,
  }) async {
    final response = await ref
        .read(mtClientProvider)
        .agent
        .openAgent(
          openAgentRequest: OpenAgentRequest(
            machineId: machineId,
            teamId: teamId,
            nickname: (nickname ?? '').trim().isEmpty ? null : nickname!.trim(),
            driver: (driver ?? '').trim().isEmpty ? null : driver!.trim(),
            cwd: (cwd ?? '').trim().isEmpty ? null : cwd!.trim(),
          ),
        );
    ref.invalidateSelf();
    final opened = response.data;
    if (opened == null) {
      throw StateError('the server opened an agent but did not say which');
    }
    return opened;
  }

  /// Rename an agent.
  ///
  /// This is a change to the agent's own profile, which a human cannot make directly — the identity
  /// service lets a user change only their own — so the server makes it as the agent. Which is why
  /// it is one call here and not "fetch profile, edit, put it back".
  Future<void> rename(Agent agent, String nickname) async {
    await ref
        .read(mtClientProvider)
        .agent
        .setAgentNickname(
          userId: agent.userId,
          setAgentNicknameRequest: SetAgentNicknameRequest(
            nickname: nickname.trim(),
          ),
        );
    ref.invalidateSelf();
  }

  /// Point an agent's profile at an already-uploaded picture.
  ///
  /// The upload itself happens as the signed-in human, against the identity service; only this
  /// half needs mt, because the identity service lets a user write only their own profile and this
  /// change is made as the agent.
  Future<void> setAvatar(Agent agent, int avatarId) async {
    await ref
        .read(mtClientProvider)
        .agent
        .setAgentAvatar(
          userId: agent.userId,
          setAgentAvatarRequest: SetAgentAvatarRequest(avatarId: avatarId),
        );
    ref.invalidateSelf();
  }

  /// Turn the agent's cache keepalive on or off.
  ///
  /// What it buys is not liveness: it is the driver's prefix cache not expiring, so an idle agent's
  /// context never has to be rebuilt — a rebuild costs a large slice of the account's rolling
  /// quota. That is why this is worth a switch rather than being always-on.
  Future<void> setKeepalive(
    Agent agent, {
    required bool enabled,
    int? intervalSeconds,
  }) async {
    await ref
        .read(mtClientProvider)
        .agent
        .setAgentKeepalive(
          userId: agent.userId,
          setAgentKeepaliveRequest: SetAgentKeepaliveRequest(
            enabled: enabled,
            intervalSeconds: intervalSeconds,
          ),
        );
    ref.invalidateSelf();
  }

  /// Rename a machine. The name is this human's label for it, not an identifier.
  Future<void> renameMachine(Machine machine, String name) async {
    await ref
        .read(mtClientProvider)
        .machine
        .renameMachine(
          id: machine.id,
          renameMachineRequest: RenameMachineRequest(name: name.trim()),
        );
    ref.invalidateSelf();
    ref.invalidate(allMachinesProvider);
  }

  /// Let a team run agents on a machine it can already see but is not using yet.
  ///
  /// Which team is a parameter: a machine's own detail offers every team you are in, not only the
  /// one you happen to be looking at.
  Future<void> bind(String machineId, {int? teamId}) async {
    final team = teamId ?? ref.read(currentTeamProvider)?.id;
    if (team == null) return;
    await ref
        .read(mtClientProvider)
        .team
        .bindTeamMachine(
          id: team,
          bindMachineRequest: BindMachineRequest(machineId: machineId),
        );
    ref.invalidateSelf();
    ref.invalidate(allMachinesProvider);
  }

  /// Forget a machine entirely — for every team it serves, not just this one.
  ///
  /// The host keeps its connector installed; it would have to enrol again to come back. That is
  /// why this is not the same button as "remove from this team", and why the surfaces put it
  /// somewhere you have to mean it.
  Future<void> forget(Machine machine) async {
    await ref.read(mtClientProvider).machine.forgetMachine(id: machine.id);
    ref.invalidateSelf();
    ref.invalidate(allMachinesProvider);
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

/// The drivers this server supports, and which one it would pick.
///
/// Asked of the server rather than listed here, because the answer belongs to the deployment: a
/// client with a hard-coded list offers a driver the server cannot run, and hides one it can.
final driversProvider = FutureProvider<AgentDrivers?>((ref) async {
  final response = await ref.read(mtClientProvider).agent.listAgentDrivers();
  return response.data;
});

/// Every machine this human has, whatever team it serves.
///
/// Separate from [agentsProvider]'s list, which is deliberately scoped to one team: this is for
/// "add a machine you already have", where the whole point is the machines this team does NOT
/// have yet.
final allMachinesProvider = FutureProvider<List<Machine>>((ref) async {
  final response = await ref
      .read(mtClientProvider)
      .machine
      .listMachines(pageSize: 100);
  return response.data?.machines ?? const <Machine>[];
});
