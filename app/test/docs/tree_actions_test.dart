// What you can do TO the tree, done in the tree.
//
// These used to live in the corner of an open document: rename, move, delete. That is the wrong
// place twice over — a delete button you meet while reading is one you can press while reading, and
// a document you have not opened had no way to be renamed at all. The React client put them on the
// nodes; so does this.
//
// Renaming happens in place: the row becomes a field and a tick. A dialog for a name is a frame you
// have to dismiss to see the thing you are naming.

import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:microteams/src/auth/auth_api.dart';
import 'package:microteams/src/common/api.dart';
import 'package:microteams/src/common/config.dart';
import 'package:microteams/src/common/ui/theme.dart';
import 'package:microteams/src/docs/docs_screen.dart';
import 'package:microteams/src/providers.dart';

class _Fake implements HttpClientAdapter {
  final List<({String call, Object? body})> wrote = [];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final call = '${options.method} ${options.uri.path}';
    if (options.method != 'GET') wrote.add((call: call, body: options.data));

    const page =
        '"page":{"page_start":1,"page_size":100,"has_prev":false,"has_more":false}';
    final body = switch (options.uri.path) {
      '/mt/team' => '{"teams":[{"id":1,"name":"One"}],$page}',
      '/mt/team/1/document' =>
        '{"path":"","isFolder":true,"children":['
            '{"path":"notes","isFolder":true,"children":['
            '{"path":"notes/idea.md","isFolder":false}]},'
            '{"path":"README.md","isFolder":false}]}',
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
  child: MaterialApp(
    theme: darkTheme(),
    home: DocsScreen(onManageTeams: () {}, onOpen: (_) {}),
  ),
);

Future<void> settle(WidgetTester tester) async {
  await tester.pumpAndSettle();
  await tester.pumpAndSettle();
}

/// Open the actions menu on the row showing [name].
Future<void> actionsOn(WidgetTester tester, String name) async {
  await tester.tap(
    find.descendant(
      of: find.ancestor(of: find.text(name), matching: find.byType(Row)).first,
      matching: find.byIcon(Icons.more_horiz),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('every node carries its own actions', (tester) async {
    await tester.pumpWidget(_host(_Fake()));
    await settle(tester);

    await actionsOn(tester, 'idea.md');
    expect(find.text('new file'), findsOneWidget);
    expect(find.text('rename'), findsOneWidget);
    expect(find.text('move'), findsOneWidget);
    expect(find.text('delete'), findsOneWidget);
  });

  testWidgets('renaming happens in the row, not in a dialog', (tester) async {
    final backend = _Fake();
    await tester.pumpWidget(_host(backend));
    await settle(tester);

    await actionsOn(tester, 'idea.md');
    await tester.tap(find.text('rename'));
    await tester.pumpAndSettle();

    // The row itself became the field: no dialog was pushed over it.
    expect(find.byType(AlertDialog), findsNothing);
    expect(find.byType(TextField), findsOneWidget);

    await tester.enterText(find.byType(TextField), 'plan.md');
    await tester.tap(find.byIcon(Icons.check));
    await settle(tester);

    // Renamed WITHIN its folder: a name is not a path, and typing one must not move the file to the
    // root.
    final moved = backend.wrote.single;
    expect(moved.call, 'PATCH /mt/team/1/document');
    expect(moved.body, contains('notes/plan.md'));
  });

  testWidgets('a new file under a folder goes inside it', (tester) async {
    final backend = _Fake();
    await tester.pumpWidget(_host(backend));
    await settle(tester);

    await actionsOn(tester, 'notes');
    await tester.tap(find.text('new file'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).last, 'second.md');
    await tester.tap(find.widgetWithText(TextButton, 'create'));
    await settle(tester);

    expect(backend.wrote.single.call, 'PUT /mt/team/1/document');
    expect(
      backend.wrote.single.body,
      isNot(contains('"path"')),
      reason: 'the document body is the file itself, not a JSON envelope',
    );
  });

  testWidgets('a new file beside a file goes beside it', (tester) async {
    // Pointing at a file and asking for a new one means "another one here", not "one inside that
    // file", which is not a thing.
    final backend = _Fake();
    await tester.pumpWidget(_host(backend));
    await settle(tester);

    await actionsOn(tester, 'idea.md');
    await tester.tap(find.text('new file'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).last, 'second.md');
    await tester.tap(find.widgetWithText(TextButton, 'create'));
    await settle(tester);

    expect(backend.wrote.single.call, 'PUT /mt/team/1/document');
  });

  testWidgets('deleting asks first', (tester) async {
    final backend = _Fake();
    await tester.pumpWidget(_host(backend));
    await settle(tester);

    await actionsOn(tester, 'idea.md');
    await tester.tap(find.text('delete'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(TextButton, 'cancel'));
    await settle(tester);

    expect(backend.wrote, isEmpty);
  });
}
