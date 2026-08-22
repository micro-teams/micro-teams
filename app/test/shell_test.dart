// Switching tabs must not throw your place away.
//
// The React client did this by hand — MobileTabs kept every visited tab mounted and
// sectionKeepAlive froze each section's URL — because react-router unmounts a route on every
// navigation. The first Flutter cut rebuilt the world on every tab tap, which is the single
// biggest reason it did not feel like the old client: you left docs on a file, came back, and were
// at the top of the tree again with everything refetched.
//
// What this test watches is WHERE a tab lands when you return to it. A branch that kept its place
// comes back to the conversation you were reading; one that was thrown away comes back to the list.
// (Watching for a refetch instead would prove nothing here — the providers are not autoDispose, so
// they hold their value whether or not the widgets under them survived. That version of this test
// passed with the fix reverted, which is how it was caught.)

import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:microteams/src/app.dart';
import 'package:microteams/src/auth/auth_api.dart';
import 'package:microteams/src/common/api.dart';
import 'package:microteams/src/common/config.dart';
import 'package:microteams/src/common/ui/avatar.dart';
import 'package:microteams/src/common/ui/destination_button.dart';
import 'package:microteams/src/providers.dart';

class _Fake implements HttpClientAdapter {
  final List<String> asked = [];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final path = options.uri.path;
    asked.add('${options.method} $path');

    const page =
        '"page":{"page_start":1,"page_size":100,"has_prev":false,"has_more":false}';
    // Any team's roster, because which team is open is the test's business, not the fake's.
    if (path.endsWith('/members')) {
      return ResponseBody.fromString(
        '[{"userId":1,"nickname":"Me","role":"OWNER"}]',
        200,
        headers: {
          Headers.contentTypeHeader: [Headers.jsonContentType],
        },
      );
    }

    final body = switch (path) {
      '/mt/team' =>
        '{"teams":[{"id":1,"name":"Team One"},{"id":2,"name":"Team Two"}],$page}',
      '/mt/team/1/document' =>
        '{"path":"","isFolder":true,"children":['
            '{"path":"notes.md","isFolder":false}]}',
      '/mt/chat' =>
        '{"chats":[{"id":7,"title":"standup",'
            '"updatedAt":"2026-08-20T00:00:00Z",'
            '"members":[{"userId":1,"nickname":"Me"}]}],$page}',
      '/mt/chat/7' =>
        '{"thread":{"id":7,"title":"standup","createdAt":"2026-08-20T00:00:00Z"},'
            '"members":[{"id":1,"threadId":7,"userId":1,"role":"OWNER",'
            '"joinedAt":"2026-08-20T00:00:00Z","nickname":"Me"}]}',
      '/mt/chat/7/messages' => '{"messages":[],$page}',
      '/mt/machine' => '{"machines":[],$page}',
      '/mt/agent' => '{"agents":[],$page}',
      _ => '{}',
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

Widget _app(_Fake backend) => ProviderScope(
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
  child: const MicroTeamsApp(),
);

/// A window wide enough for the rail and a conversation beside the list.
void _wide(WidgetTester tester) {
  tester.view.physicalSize = const Size(1400, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

/// A destination button — the same control on both shells, so this finds it on either. The list
/// pane's header says "chats" too, which is why the buttons carry a key.
Finder _rail(String label) => find.byKey(ValueKey('destination-$label'));

void main() {
  testWidgets('a tab you come back to is the tab you left', (tester) async {
    // A wide window, where the rail is always there. On a phone an open conversation covers the
    // tab bar on purpose — the same as the React shell, where a detail route is its own layout —
    // so there is no tab to tap from inside one.
    _wide(tester);

    final backend = _Fake();
    await tester.pumpWidget(_app(backend));
    await tester.pumpAndSettle();

    // Open a conversation, so the chats branch is somewhere other than its root.
    await tester.tap(find.text('standup'));
    await tester.pumpAndSettle();
    expect(find.byType(TextField), findsOneWidget, reason: 'the composer');

    await tester.tap(_rail('agents'));
    await tester.pumpAndSettle();
    expect(find.text('agents'), findsWidgets);

    await tester.tap(_rail('chats'));
    await tester.pumpAndSettle();

    expect(
      find.byType(TextField),
      findsOneWidget,
      reason:
          'coming back to chats comes back to the conversation that was open, '
          'not to the list',
    );
  });

  testWidgets('tapping the tab you are already on goes back to its root', (
    tester,
  ) async {
    // The other half of the same rule, and the one people reach for to get out of a detail view.
    _wide(tester);

    await tester.pumpWidget(_app(_Fake()));
    await tester.pumpAndSettle();
    await tester.tap(find.text('standup'));
    await tester.pumpAndSettle();
    expect(find.byType(TextField), findsOneWidget);

    await tester.tap(_rail('chats'));
    await tester.pumpAndSettle();

    // Back at the list with nothing open: no composer, and the row still there to open again.
    expect(find.byType(TextField), findsNothing);
    expect(find.text('standup'), findsOneWidget);
  });

  testWidgets('the rail is three destinations and your own face', (
    tester,
  ) async {
    // The React rail's shape, and the reason to copy it: a rail item per route is how navigation
    // grows until nothing on it is where anyone remembers. Teams is reached from the team picker,
    // profile from the avatar.
    _wide(tester);
    await tester.pumpWidget(_app(_Fake()));
    await tester.pumpAndSettle();

    expect(_rail('chats'), findsOneWidget);
    expect(_rail('docs'), findsOneWidget);
    expect(_rail('agents'), findsOneWidget);
    expect(
      find.descendant(of: _rail('me'), matching: find.byType(UserAvatar)),
      findsOneWidget,
      reason: 'the signed-in human, pinned at the bottom',
    );
    expect(_rail('teams'), findsNothing);
  });

  testWidgets('team management is reached from the team picker', (
    tester,
  ) async {
    _wide(tester);
    await tester.pumpWidget(_app(_Fake()));
    await tester.pumpAndSettle();

    await tester.tap(_rail('docs'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Team One'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('manage teams'));
    await tester.pumpAndSettle();

    expect(find.text('teams'), findsWidgets, reason: 'the management screen');
  });

  testWidgets('coming back out of a conversation leaves the bar where it was', (
    tester,
  ) async {
    // The complaint this pins: on a phone you open a chat and come back, and the bottom bar is
    // gone. Whatever the shell hides while you are inside a conversation, it has to put back.
    tester.view.physicalSize = const Size(400, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(_app(_Fake()));
    await tester.pumpAndSettle();
    expect(_rail('chats'), findsOneWidget);

    await tester.tap(find.text('standup'));
    await tester.pumpAndSettle();

    await tester.pageBack();
    await tester.pumpAndSettle();

    expect(_rail('chats'), findsOneWidget);
  });

  testWidgets('opening a document is a frame, so back closes the document', (
    tester,
  ) async {
    // It used to be a query parameter on the docs route, which is not a frame at all: back left
    // the section entirely instead of closing the file you were reading.
    tester.view.physicalSize = const Size(400, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(_app(_Fake()));
    await tester.pumpAndSettle();
    await tester.tap(find.text('docs'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('notes.md'));
    await tester.pumpAndSettle();

    await tester.tap(find.byIcon(Icons.arrow_back));
    await tester.pumpAndSettle();

    expect(
      find.text('notes.md'),
      findsOneWidget,
      reason:
          'back closed the file and left the tree, rather than leaving docs',
    );
    expect(_rail('chats'), findsOneWidget);
  });

  testWidgets('a team opens beside its list on a wide window', (tester) async {
    // The same shape as chats and agents. A section that arranged itself differently would be a
    // section people have to learn separately.
    _wide(tester);
    await tester.pumpWidget(_app(_Fake()));
    await tester.pumpAndSettle();

    await tester.tap(_rail('docs'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Team One'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('manage teams'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Team Two'));
    await tester.pumpAndSettle();

    // Both at once: the list did not go anywhere.
    expect(find.text('Team One'), findsWidgets);
    expect(
      find.text('delete this team'),
      findsOneWidget,
      reason: 'the team detail is beside the list, not instead of it',
    );
  });

  testWidgets('both shells use the same destination control', (tester) async {
    // The point of the exercise: one control, arranged two ways. Before this the desktop had
    // square buttons with the word inside and the phone had Material's navigation bar — the same
    // app wearing two faces, and every later change to one had to be remembered for the other.
    _wide(tester);
    await tester.pumpWidget(_app(_Fake()));
    await tester.pumpAndSettle();
    final onRail = tester.widget<DestinationButton>(
      find.descendant(
        of: _rail('chats'),
        matching: find.byType(DestinationButton),
        matchRoot: true,
      ),
    );

    tester.view.physicalSize = const Size(400, 800);
    await tester.pumpAndSettle();
    final onPhone = tester.widget<DestinationButton>(
      find.descendant(
        of: _rail('chats'),
        matching: find.byType(DestinationButton),
        matchRoot: true,
      ),
    );

    expect(onRail.destination.label, onPhone.destination.label);
    expect(onRail.runtimeType, onPhone.runtimeType);
  });

  testWidgets('your own face opens the profile, without asking first', (
    tester,
  ) async {
    // Logging out already lives inside the profile, so a two-item menu in front of a page holding
    // one of those two items is a door in front of a door.
    _wide(tester);
    await tester.pumpWidget(_app(_Fake()));
    await tester.pumpAndSettle();

    await tester.tap(_rail('me'));
    await tester.pumpAndSettle();

    expect(find.text('log out'), findsOneWidget, reason: 'the profile itself');
    expect(find.byType(PopupMenuButton<int>), findsNothing);
  });
}
