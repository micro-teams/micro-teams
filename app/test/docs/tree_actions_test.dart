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
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:microteams/src/auth/auth_api.dart';
import 'package:microteams/src/common/api.dart';
import 'package:microteams/src/common/config.dart';
import 'package:microteams/src/common/ui/theme.dart';
import 'package:microteams/src/docs/docs_screen.dart';
import 'package:microteams/src/providers.dart';
import '../support/router_host.dart';

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
  child: routed(
    DocsScreen(onManageTeams: () {}, onOpen: (_) {}),
    theme: darkTheme(),
  ),
);

Future<void> settle(WidgetTester tester) async {
  await tester.pumpAndSettle();
  await tester.pumpAndSettle();
}

/// Open the tree down to the file these tests work on.
///
/// Nothing is open to begin with — a tree that arrives fully expanded is a list of every file in
/// the repository — so a test that wants a row inside a folder has to do what a reader does.
Future<void> openTree(WidgetTester tester) async {
  // The team's own row is the tree's root; the same name is also on the team picker in the header.
  await tester.tap(find.byIcon(Icons.folder_outlined).first);
  await settle(tester);
  await tester.tap(find.text('notes'));
  await settle(tester);
}

/// Open the actions menu on the row showing [name].
///
/// With a hover first, because that is now what makes it visible: a column of identical "..."
/// buttons down every row reads as more important than the names beside them.
Future<void> actionsOn(WidgetTester tester, String name) async {
  final row = find
      .ancestor(of: find.text(name), matching: find.byType(Row))
      .first;
  final pointer = await tester.createGesture(kind: PointerDeviceKind.mouse);
  await pointer.addPointer(location: Offset.zero);
  addTearDown(pointer.removePointer);
  await tester.pump();
  await pointer.moveTo(tester.getCenter(row));
  await tester.pumpAndSettle();

  await tester.tap(
    find.descendant(of: row, matching: find.byIcon(Icons.more_horiz)),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('every node carries its own actions', (tester) async {
    await tester.pumpWidget(_host(_Fake()));
    await settle(tester);
    await openTree(tester);

    await actionsOn(tester, 'idea.md');
    expect(find.text('new file'), findsOneWidget);
    expect(find.text('rename'), findsOneWidget);
    expect(find.text('move'), findsOneWidget);
    expect(find.text('delete'), findsOneWidget);
  });

  // Renaming in the row — and renaming WITHIN the folder rather than moving the file to the root —
  // is the machine journey's too: it renames a file it made and then finds it under the same folder.
  //
  // Where a new file lands — inside the folder you asked, beside the file you asked — is the
  // machine journey's now (integration_test/machine_journey_test.dart). It makes a folder, puts a
  // file in it and another beside that one, and reads the answer off the tree itself rather than
  // off the shape of the request, which is all a fake backend can show.

  testWidgets('deleting asks first', (tester) async {
    final backend = _Fake();
    await tester.pumpWidget(_host(backend));
    await settle(tester);
    await openTree(tester);

    await actionsOn(tester, 'idea.md');
    await tester.tap(find.text('delete'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(TextButton, 'cancel'));
    await settle(tester);

    expect(backend.wrote, isEmpty);
  });
}
