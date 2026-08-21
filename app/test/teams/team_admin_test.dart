// Team management, and the three judgements in it that are not layout.
//
// Everything a mutation can change is refetched rather than patched locally, because a local edit
// that disagrees with the server is a screen that lies until you leave it. These tests watch what
// was ASKED of the server, which is the only way to tell a real refetch from a hopeful one.

import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:microteams/src/auth/auth_api.dart';
import 'package:microteams/src/common/config.dart';
import 'package:microteams/src/common/api.dart';
import 'package:microteams/src/common/team_scope.dart';
import 'package:microteams/src/common/ui/theme.dart';
import 'package:microteams/src/providers.dart';
import 'package:microteams/src/teams/team_screen.dart';
import 'package:microteams/src/teams/teams_screen.dart';

/// One team with two members, and a log of every request made.
class _Fake implements HttpClientAdapter {
  final List<String> asked = [];
  bool teamDeleted = false;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final path = options.uri.path;
    asked.add('${options.method} $path');

    if (options.method == 'DELETE' && path == '/mt/team/1') {
      teamDeleted = true;
      return _json('{}');
    }
    if (path.endsWith('/members')) {
      if (options.method != 'GET') return _json('{}');
      return _json(
        '[{"userId":1,"nickname":"Me","role":"OWNER"},'
        '{"userId":2,"nickname":"Them","role":"MEMBER"}]',
      );
    }
    if (path == '/mt/team') {
      if (options.method != 'GET') return _json('{"id":9,"name":"new"}');
      return _json(
        teamDeleted
            ? '{"teams":[],"page":{"page_start":0,"page_size":100,'
                  '"has_prev":false,"has_more":false}}'
            : '{"teams":[{"id":1,"name":"Bundle Check"}],'
                  '"page":{"page_start":0,"page_size":100,'
                  '"has_prev":false,"has_more":false}}',
      );
    }
    return _json('{}');
  }

  ResponseBody _json(String body) => ResponseBody.fromString(
    body,
    200,
    headers: {
      Headers.contentTypeHeader: [Headers.jsonContentType],
    },
  );

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

Widget _host(_Fake backend, Widget child) => ProviderScope(
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
  child: MaterialApp(theme: darkTheme(), home: child),
);

void main() {
  testWidgets('the roster is shown with each member\'s role', (tester) async {
    final backend = _Fake();
    await tester.pumpWidget(
      _host(backend, TeamScreen(teamId: 1, onGone: () {})),
    );
    await tester.pumpAndSettle();

    expect(find.text('Me'), findsOneWidget);
    expect(find.text('Them'), findsOneWidget);
    expect(find.text('owner'), findsOneWidget);
    expect(find.text('member'), findsOneWidget);
  });

  testWidgets('your own row offers nothing', (tester) async {
    // Demoting or removing yourself out of a team you administer is the one action with no way
    // back from inside the app.
    final backend = _Fake();
    await tester.pumpWidget(
      _host(backend, TeamScreen(teamId: 1, onGone: () {})),
    );
    await tester.pumpAndSettle();

    final menus = tester
        .widgetList<PopupMenuButton<String>>(
          find.byType(PopupMenuButton<String>),
        )
        .toList();
    expect(menus, hasLength(2));
    expect(menus.first.enabled, isFalse, reason: 'the first row is me');
    expect(menus.last.enabled, isTrue);
  });

  testWidgets('changing a role asks the server, then asks the roster again', (
    tester,
  ) async {
    final backend = _Fake();
    await tester.pumpWidget(
      _host(backend, TeamScreen(teamId: 1, onGone: () {})),
    );
    await tester.pumpAndSettle();
    backend.asked.clear();

    await tester.tap(find.byType(PopupMenuButton<String>).last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('make admin'));
    await tester.pumpAndSettle();

    expect(backend.asked, contains('PATCH /mt/team/1/members/2'));
    expect(
      backend.asked,
      contains('GET /mt/team/1/members'),
      reason: 'the roster is refetched rather than patched in place',
    );
  });

  testWidgets('deleting a team needs its name typed, not just a tap', (
    tester,
  ) async {
    final backend = _Fake();
    var gone = false;
    await tester.pumpWidget(
      _host(backend, TeamScreen(teamId: 1, onGone: () => gone = true)),
    );
    await tester.pumpAndSettle();

    final delete = find.widgetWithText(FilledButton, 'delete this team');
    await tester.ensureVisible(delete);
    await tester.tap(delete);
    await tester.pumpAndSettle();

    // Confirming without typing the name does nothing at all.
    await tester.tap(find.widgetWithText(TextButton, 'delete'));
    await tester.pumpAndSettle();
    expect(backend.teamDeleted, isFalse);
    expect(gone, isFalse);

    await tester.tap(delete);
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'Bundle Check');
    await tester.tap(find.widgetWithText(TextButton, 'delete'));
    await tester.pumpAndSettle();
    expect(backend.teamDeleted, isTrue);
    expect(gone, isTrue);
  });

  testWidgets('a new team becomes the selected one', (tester) async {
    // Made and then not selected is a team you have to go and find; making one is a statement of
    // where you intend to work.
    final backend = _Fake();
    late WidgetRef ref;
    await tester.pumpWidget(
      _host(
        backend,
        Consumer(
          builder: (context, r, _) {
            ref = r;
            return TeamsScreen(onOpen: (_) {});
          },
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byIcon(Icons.add));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'new');
    await tester.tap(find.widgetWithText(TextButton, 'create'));
    await tester.pumpAndSettle();

    expect(backend.asked, contains('POST /mt/team'));
    expect(ref.read(selectedTeamProvider), 9);
  });
}
