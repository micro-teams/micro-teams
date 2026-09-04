// Opening an agent and adding a machine — the two ways anything gets into this screen.
//
// Both were missing entirely from the Flutter client while the React one had them, which made the
// whole surface read-only. What these pin is not the layout but the three judgements in them:
//
//   * the driver list comes from the SERVER, so a deployment's drivers are the offered ones;
//   * an empty field means "the server decides", so nothing is sent for it;
//   * "add a device" only offers machines this team is not already using.

import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:microteams/src/agents/agents_screen.dart';
import 'package:microteams/src/auth/auth_api.dart';
import 'package:microteams/src/common/api.dart';
import 'package:microteams/src/common/config.dart';
import 'package:microteams/src/providers.dart';
import '../support/router_host.dart';

class _Fake implements HttpClientAdapter {
  _Fake({this.machineTeams = const [1], this.name = 'box'});

  /// What the connected machine is called. A long one is the case the dialog has to survive on a
  /// phone, and a machine gets its name from whoever installed it.
  final String name;

  /// Which teams hold the second machine — the one this team could still adopt.
  final List<int> machineTeams;

  /// Every write, with the body it carried: what was SENT is the whole question here.
  final List<({String call, Object? body})> wrote = [];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final path = options.uri.path;
    final call = '${options.method} $path';
    if (options.method != 'GET') wrote.add((call: call, body: options.data));

    // The real server filters by team; a fake that does not would let the screen show a machine
    // the "add a device" dialog is about to offer, and the test would be pinning a screen nobody
    // will ever see.
    final teamFilter = options.uri.queryParameters['teamId'];
    final machines =
        [
          {
            'id': 'm1',
            'name': name,
            'online': true,
            'teamIds': [1],
          },
          {
            'id': 'm2',
            'name': 'spare',
            'online': false,
            'teamIds': machineTeams,
          },
        ].where(
          (m) =>
              teamFilter == null ||
              (m['teamIds']! as List).contains(int.parse(teamFilter)),
        );

    final body = switch (call) {
      'GET /mt/team' =>
        '{"teams":[{"id":1,"name":"Team One"}],'
            '"page":{"page_start":1,"page_size":100,"has_prev":false,"has_more":false}}',
      'GET /mt/machine' => jsonEncode({
        'machines': machines.toList(),
        'page': {
          'page_start': 1,
          'page_size': 100,
          'has_prev': false,
          'has_more': false,
        },
      }),
      'GET /mt/agent' =>
        '{"agents":[],'
            '"page":{"page_start":1,"page_size":100,"has_prev":false,"has_more":false}}',
      'GET /mt/agent/drivers' =>
        '{"drivers":["claude","codex"],"defaultDriver":"claude"}',
      _ => '{"userId":99,"nickname":"new","online":true}',
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

Widget _host(_Fake backend) => ProviderScope(
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
  child: routed(
    AgentsScreen(
      onOpenAgent: (_) {},
      onOpenMachine: (_) {},
      onManageTeams: () {},
    ),
  ),
);

void main() {
  group('open agent', () {
    testWidgets('every field is on the form, none behind "advanced"', (
      tester,
    ) async {
      // T-018: the two fields that were behind the disclosure — driver and working directory —
      // are the two people actually wanted to set.
      await tester.pumpWidget(_host(_Fake()));
      await tester.pumpAndSettle();
      await tester.tap(find.text('open agent'));
      await tester.pumpAndSettle();

      expect(find.text('Machine'), findsOneWidget);
      expect(find.text('Name'), findsOneWidget);
      expect(find.text('Driver'), findsOneWidget);
      expect(find.text('Working directory'), findsOneWidget);
      expect(find.textContaining('Advanced'), findsNothing);
    });

    testWidgets('sends nothing for a field left empty', (tester) async {
      final backend = _Fake();
      await tester.pumpWidget(_host(backend));
      await tester.pumpAndSettle();
      await tester.tap(find.text('open agent'));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      final open = backend.wrote.firstWhere((w) => w.call == 'POST /mt/agent');
      final sent = jsonDecode(open.body! as String) as Map<String, Object?>;
      expect(
        sent['machineId'],
        'm1',
        reason: 'the connected machine is picked',
      );
      expect(sent['teamId'], 1);
      // An empty name is not a name — sending "" would make the server call the agent that.
      expect(sent.containsKey('nickname'), isFalse);
      expect(sent.containsKey('cwd'), isFalse);
    });

    // A phone, and a machine with a name somebody actually typed. The item in a dropdown is as
    // wide as its text unless the dropdown is told to expand, so one long name pushed 55 pixels of
    // itself off the side of the dialog — and Flutter treats content that cannot be seen as a
    // failure, which is how the Android journey found it. Reverse-checked: without `isExpanded`
    // on the two dropdowns this goes red.
    testWidgets('a long machine name stays inside the dialog on a phone', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(1080, 2400);
      tester.view.devicePixelRatio = 3.0;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(
        _host(_Fake(name: 'chengxin-dev-box-in-the-office')),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('open agent'));
      await tester.pumpAndSettle();

      expect(
        tester.takeException(),
        isNull,
        reason: 'nothing in this dialog may be painted where it cannot be seen',
      );
    });

    testWidgets('previews the working directory the server would choose', (
      tester,
    ) async {
      await tester.pumpWidget(_host(_Fake()));
      await tester.pumpAndSettle();
      await tester.tap(find.text('open agent'));
      await tester.pumpAndSettle();

      await tester.enterText(
        find.widgetWithText(TextField, 'the server names it if you do not'),
        'My Agent 2',
      );
      await tester.pumpAndSettle();

      expect(
        find.text('~/.local/share/microteams/agents/my-agent-2'),
        findsOneWidget,
      );
    });
  });

  group('add a device', () {
    testWidgets('offers only the machines this team is not using', (
      tester,
    ) async {
      await tester.pumpWidget(_host(_Fake(machineTeams: const [2])));
      await tester.pumpAndSettle();

      await tester.tap(find.text('add device'));
      await tester.pumpAndSettle();

      // Scoped to the dialog: "box" is legitimately on the screen behind it — it is this team's
      // machine. What must not happen is being offered it again.
      final inDialog = find.descendant(
        of: find.byType(AlertDialog),
        matching: find.text('box'),
      );
      expect(
        find.descendant(
          of: find.byType(AlertDialog),
          matching: find.text('spare'),
        ),
        findsOneWidget,
      );
      expect(
        inDialog,
        findsNothing,
        reason: 'a machine this team already has is not something to add',
      );
    });

    testWidgets('offers no reuse at all when there is nothing spare', (
      tester,
    ) async {
      await tester.pumpWidget(_host(_Fake(machineTeams: const [1])));
      await tester.pumpAndSettle();

      await tester.tap(find.text('add device'));
      await tester.pumpAndSettle();

      expect(find.text('A machine you already have'), findsNothing);
      // The other half is always there: it is a tutorial, and it needs no data.
      expect(find.textContaining('install.sh'), findsOneWidget);
      // And it carries the deployment's address in full. This command is typed on ANOTHER machine,
      // where `curl -fsSL /install.sh` means nothing at all — and on the web the app's own origin
      // is deliberately the empty string, because every request it makes is relative.
      expect(
        find.textContaining('http://backend.test/install.sh'),
        findsOneWidget,
      );
    });
  });
}
