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
import 'package:microteams/src/agents/agents_screen.dart';
import 'package:microteams/src/common/api.dart';

/// Answers the four calls this screen makes, and records what it was asked to do.
class _FakeBackend implements HttpClientAdapter {
  _FakeBackend({this.chats = '[]', this.machineTeams = const [1]});

  /// The caller's existing chats, as raw JSON — a test decides whether the 1:1 already exists.
  final String chats;

  /// Which teams hold the one machine. One team means removing it would orphan it.
  final List<int> machineTeams;

  final List<String> posted = [];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final path = options.uri.path;
    if (options.method != 'GET') posted.add('${options.method} $path');

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
            '"machineId":"m1","sid":"s1","driver":"claude"}],'
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
Widget host(_FakeBackend backend, {void Function(int threadId)? onOpenChat}) =>
    ProviderScope(
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
      child: MaterialApp(
        home: AgentsScreen(
          onOpenScreen: (_) {},
          onOpenChat: onOpenChat ?? (_) {},
          onManageTeams: () {},
        ),
      ),
    );

/// Open the one agent's sheet. Every per-agent action lives in there now — the row is the agent,
/// not a strip of icon buttons, so a test that taps an action taps it where a person would.
Future<void> openAgent(WidgetTester tester) async {
  await tester.tap(find.text('agent3'));
  await tester.pumpAndSettle();
}

Future<void> openMachine(WidgetTester tester) async {
  await tester.tap(find.text('box'));
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
    testWidgets('reuses the existing one-to-one', (tester) async {
      final backend = _FakeBackend(
        chats:
            '[{"id":9,"title":"agent3","updatedAt":"2026-08-20T00:00:00Z",'
            '"members":[{"userId":1,"nickname":"Me"},{"userId":42,"nickname":"agent3"}]}]',
      );
      int? opened;
      await tester.pumpWidget(host(backend, onOpenChat: (id) => opened = id));
      await tester.pumpAndSettle();

      await openAgent(tester);
      await tester.tap(find.text('Chat with agent'));
      await tester.pumpAndSettle();

      expect(opened, 9);
      expect(
        backend.posted.where((p) => p.startsWith('POST')),
        isEmpty,
        reason:
            'creating another conversation with the same agent is how the chat '
            'list fills up with duplicates',
      );
    });

    testWidgets('creates one when there is none', (tester) async {
      final backend = _FakeBackend();
      int? opened;
      await tester.pumpWidget(host(backend, onOpenChat: (id) => opened = id));
      await tester.pumpAndSettle();

      await openAgent(tester);
      await tester.tap(find.text('Chat with agent'));
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
      await tester.pumpWidget(host(backend, onOpenChat: (id) => opened = id));
      await tester.pumpAndSettle();

      await openAgent(tester);
      await tester.tap(find.text('Chat with agent'));
      await tester.pumpAndSettle();

      expect(opened, 77);
    });
  });

  group('removing a machine from a team', () {
    testWidgets('is not offered when this team is the only one holding it', (
      tester,
    ) async {
      await tester.pumpWidget(host(_FakeBackend(machineTeams: const [1])));
      await tester.pumpAndSettle();
      await openMachine(tester);

      expect(
        find.text('Remove from this team'),
        findsNothing,
        reason:
            'unbinding the last team orphans the machine and the backend forgets '
            'it — an action that exists and refuses invites finding that out',
      );
    });

    testWidgets('is offered when another team still holds it', (tester) async {
      await tester.pumpWidget(host(_FakeBackend(machineTeams: const [1, 2])));
      await tester.pumpAndSettle();
      await openMachine(tester);

      expect(find.text('Remove from this team'), findsOneWidget);
    });
  });

  testWidgets('closing an agent asks first', (tester) async {
    final backend = _FakeBackend();
    await tester.pumpWidget(host(backend));
    await tester.pumpAndSettle();

    await openAgent(tester);
    await tester.tap(find.text('Close agent'));
    await tester.pumpAndSettle();

    expect(find.text('Close agent3?'), findsOneWidget);
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();

    expect(
      backend.posted.where((p) => p.contains('close')),
      isEmpty,
      reason: 'cancel has to mean cancel',
    );
  });
}
