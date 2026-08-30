// The rules the agents surface has to keep, driven against a fake backend.
//
// Two of these are the reason the corresponding React code looks the way it does:
//
//   * "Chat with this agent" must REUSE the existing one-to-one. Without that, every tap piles up
//     another duplicate conversation with the same agent, and nobody notices until the chat list
//     is full of them.
//   * Removing a machine from its LAST team orphans it, and the backend then forgets it outright.
//     So the action must be absent, not present-and-refusing.

import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:microteams/src/providers.dart';
import 'package:microteams/src/auth/auth_api.dart';
import 'package:microteams/src/common/config.dart';
import 'package:microteams/src/agents/agent_detail.dart';
import 'package:microteams/src/agents/agents_screen.dart';
import 'package:microteams/src/agents/machine_detail.dart';
import 'package:mt_api/mt_api.dart';
import 'package:microteams/src/common/api.dart';
import '../support/router_host.dart';

/// Answers the four calls this screen makes, and records what it was asked to do.
class _FakeBackend implements HttpClientAdapter {
  _FakeBackend({this.chats = '[]', this.machineTeams = const [1]});

  /// The caller's existing chats, as raw JSON — a test decides whether the 1:1 already exists.
  final String chats;

  /// Which teams hold the one machine. One team means removing it would orphan it.
  final List<int> machineTeams;

  final List<String> posted = [];

  /// What each write carried, in the same order as [posted].
  final List<Object?> bodies = [];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final path = options.uri.path;
    if (options.method != 'GET') {
      posted.add('${options.method} $path');
      bodies.add(options.data);
    }

    // Keyed on method AND path: listChats and createThread are both /mt/chat, and answering a
    // POST with a list of chats is a fake that lies in exactly the shape the code under test
    // cannot survive.
    final body = switch ('${options.method} $path') {
      'GET /mt/team' =>
        '{"teams":[{"id":1,"name":"Team One"}],'
            '"page":{"page_start":1,"page_size":100,"has_prev":false,"has_more":false}}',
      'GET /mt/machine' =>
        '{"machines":[{"id":"m1","name":"box","online":true,'
            '"teamIds":${jsonEncode(machineTeams)}}],'
            '"page":{"page_start":1,"page_size":100,"has_prev":false,"has_more":false}}',
      'GET /mt/agent' =>
        '{"agents":[{"userId":42,"nickname":"agent3","online":true,'
            '"machineId":"m1","sid":"s1","driver":"claude",'
            '"keepalive":{"enabled":true,"intervalSeconds":2400}}],'
            '"page":{"page_start":1,"page_size":100,"has_prev":false,"has_more":false}}',
      'GET /mt/chat' =>
        '{"chats":$chats,'
            '"page":{"page_start":1,"page_size":100,"has_prev":false,"has_more":false}}',
      _ => '{"id":77,"title":"agent3","createdAt":"2026-08-20T00:00:00Z"}',
    };

    return ResponseBody.fromString(
      body,
      200,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

/// Signed in, without a server to sign in against.
///
/// The teams list — and therefore everything scoped to a team — is deliberately empty when nobody
/// is signed in, so a test of this screen has to say who it is.
class _SignedIn extends SessionController {
  @override
  Future<Session?> build() async => const Session(
    user: AuthUser(
      id: 1,
      username: 'me',
      nickname: 'Me',
      avatarId: 0,
      intro: '',
    ),
    accessToken: 'token',
  );
}

// ignore: library_private_types_in_public_api — a test helper is not an API
Widget host(_FakeBackend backend, {void Function(Agent agent)? onOpenAgent}) =>
    _scope(
      backend,
      AgentsScreen(
        onOpenAgent: onOpenAgent ?? (_) {},
        onOpenMachine: (_) {},
        onManageTeams: () {},
      ),
    );

/// The agent's own frame, which is where every per-agent action lives now.
Widget agentDetail(
  // ignore: library_private_types_in_public_api — a test helper is not an API
  _FakeBackend backend, {
  void Function(int threadId)? onChat,
}) => _scope(
  backend,
  AgentDetailScreen(userId: 42, onChat: onChat ?? (_) {}, onGone: () {}),
);

// ignore: library_private_types_in_public_api — a test helper is not an API
Widget machineDetail(_FakeBackend backend) =>
    _scope(backend, MachineDetailScreen(machineId: 'm1', onGone: () {}));

Widget _scope(_FakeBackend backend, Widget child) => ProviderScope(
  overrides: [
    sessionProvider.overrideWith(_SignedIn.new),
    endpointsProvider.overrideWithValue(
      const Endpoints(origin: 'http://backend.test'),
    ),
    mtClientProvider.overrideWithValue(
      MtClient(
        baseUrl: 'http://backend.test/mt',
        reauthorize: () async => null,
        adapter: backend,
      ),
    ),
  ],
  child: routed(child),
);

/// Settled twice on purpose. The fleet is asked for only once the TEAM has arrived, so the first
/// settle ends with an empty list and the frame saying the agent is not there.
Future<void> settle(WidgetTester tester) async {
  await tester.pumpAndSettle();
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('lists a team\'s agents and machines together', (tester) async {
    await tester.pumpWidget(host(_FakeBackend()));
    await tester.pumpAndSettle();

    expect(find.text('agent3'), findsOneWidget);
    expect(find.text('box'), findsOneWidget);
    // The machine's NAME, not its opaque id, next to the agent that runs on it.
    expect(find.textContaining('box · claude'), findsOneWidget);
  });

  group('chat with this agent', () {
    // Asking twice and getting the SAME conversation back is the machine journey's now: it asks a
    // second time and finds what it already said still in there, which is what "the same one" means
    // to a person. What is left here is the create path against a fake, where "no chat exists yet"
    // can be arranged.

    testWidgets('creates one when there is none', (tester) async {
      final backend = _FakeBackend();
      int? opened;
      await tester.pumpWidget(
        agentDetail(backend, onChat: (id) => opened = id),
      );
      await settle(tester);

      await tester.ensureVisible(find.text('chat with agent'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('chat with agent'));
      await tester.pumpAndSettle();

      expect(opened, 77);
      expect(backend.posted, contains('POST /mt/chat'));
    });

    testWidgets('a group chat containing the agent is not the one-to-one', (
      tester,
    ) async {
      // Three members: this is a group that happens to include the agent, not the pair. Reusing it
      // would drop a private message into a room full of people.
      final backend = _FakeBackend(
        chats:
            '[{"id":9,"title":"standup","updatedAt":"2026-08-20T00:00:00Z",'
            '"members":[{"userId":1,"nickname":"Me"},{"userId":2,"nickname":"You"},{"userId":42,"nickname":"agent3"}]}]',
      );
      int? opened;
      await tester.pumpWidget(
        agentDetail(backend, onChat: (id) => opened = id),
      );
      await settle(tester);

      await tester.ensureVisible(find.text('chat with agent'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('chat with agent'));
      await tester.pumpAndSettle();

      expect(opened, 77);
    });
  });

  group('removing a machine from a team', () {
    testWidgets('is not offered when this team is the only one holding it', (
      tester,
    ) async {
      await tester.pumpWidget(
        machineDetail(_FakeBackend(machineTeams: const [1])),
      );
      await settle(tester);

      expect(
        find.byTooltip('remove from this team'),
        findsNothing,
        reason:
            'unbinding the last team orphans the machine and the backend forgets '
            'it — an action that exists and refuses invites finding that out',
      );
    });

    testWidgets('is offered when another team still holds it', (tester) async {
      await tester.pumpWidget(
        machineDetail(_FakeBackend(machineTeams: const [1, 2])),
      );
      await settle(tester);

      expect(find.byTooltip('remove from this team'), findsOneWidget);
    });
  });

  testWidgets('closing an agent asks first', (tester) async {
    final backend = _FakeBackend();
    await tester.pumpWidget(agentDetail(backend));
    await settle(tester);

    await tester.ensureVisible(find.text('close agent'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('close agent'));
    await tester.pumpAndSettle();

    expect(find.text('close agent3?'), findsOneWidget);
    await tester.tap(find.text('cancel'));
    await tester.pumpAndSettle();

    expect(
      backend.posted.where((p) => p.contains('close')),
      isEmpty,
      reason: 'cancel has to mean cancel',
    );
  });

  group('cache keepalive', () {
    testWidgets('says how often it fires, in the unit a human thinks in', (
      tester,
    ) async {
      // Stored in seconds because that is what the server takes; shown in minutes because the
      // cache TTL it exists to stay inside is about an hour.
      await tester.pumpWidget(agentDetail(_FakeBackend()));
      await settle(tester);

      expect(find.textContaining('Every 40 min'), findsOneWidget);
      expect(find.textContaining('2400'), findsNothing);
    });

    testWidgets('a changed interval is applied in seconds', (tester) async {
      final backend = _FakeBackend();
      await tester.pumpWidget(agentDetail(backend));
      await settle(tester);

      await tester.enterText(find.widgetWithText(TextField, 'every'), '30');
      await tester.pumpAndSettle();
      await tester.tap(find.text('apply'));
      await settle(tester);

      expect(backend.posted, contains('PUT /mt/agent/42/keepalive'));
      final sent =
          jsonDecode(backend.bodies.last as String) as Map<String, Object?>;
      expect(sent['enabled'], isTrue);
      expect(sent['intervalSeconds'], 1800);
    });

    testWidgets('nothing to apply until something changed', (tester) async {
      // A button that is always there and usually a no-op teaches people to press it and see.
      await tester.pumpWidget(agentDetail(_FakeBackend()));
      await settle(tester);

      expect(find.text('apply'), findsNothing);
    });
  });

  group('where the buttons are', () {
    testWidgets('each section carries the button that fills it', (
      tester,
    ) async {
      // "Add device" belongs to the machines section and "open agent" to the agents one — the same
      // place the React client put them. Both in the page's corner is one corner holding two
      // different intentions.
      await tester.pumpWidget(host(_FakeBackend()));
      await tester.pumpAndSettle();

      // Asked geometrically: the button's centre falls inside the heading's own box. Comparing
      // tops or centres directly does not work — a button is taller than a heading, and the
      // heading carries padding above it.
      bool sitsIn(String section, String button) => tester
          .getRect(find.byKey(ValueKey('section-$section')))
          .contains(tester.getCenter(find.text(button)));

      expect(sitsIn('machines', 'add device'), isTrue);
      expect(sitsIn('agents', 'open agent'), isTrue);
    });

    // Renaming an agent is the machine journey's now: it renames the one it opened and finds the new
    // name on the page. Closing is split on purpose — the journey CONFIRMS (and watches the agent
    // leave the fleet, which only means something against a real connector), while the case above
    // CANCELS, and the only way to be sure a cancel sent nothing is to hold the wire.

  });
}
