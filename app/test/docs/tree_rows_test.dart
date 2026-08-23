// The rows of the tree: their height, and when their actions are reachable.

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

import '../support/router_host.dart';

class _Fake implements HttpClientAdapter {
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    const page =
        '"page":{"page_start":1,"page_size":100,"has_prev":false,"has_more":false}';
    final body = switch (options.uri.path) {
      '/mt/team' => '{"teams":[{"id":1,"name":"One"}],$page}',
      '/mt/team/1/document' =>
        '{"path":"","isFolder":true,"children":['
            '{"path":"notes","isFolder":true,"children":['
            '{"path":"notes/idea.md","isFolder":false}]},'
            '{"path":"README.md","isFolder":false},'
            '{"path":"PLAN.md","isFolder":false}]}',
      _ => '{"path":"README.md","isFolder":false,"content":"hello"}',
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

Widget _host({String? openPath}) => ProviderScope(
  overrides: [
    sessionProvider.overrideWith(_SignedIn.new),
    endpointsProvider.overrideWithValue(
      const Endpoints(origin: 'http://backend.test'),
    ),
    mtClientProvider.overrideWithValue(
      MtClient(
        baseUrl: 'http://backend.test/mt',
        reauthorize: () async => null,
        adapter: _Fake(),
      ),
    ),
  ],
  child: routed(
    DocsScreen(onManageTeams: () {}, onOpen: (_) {}, openPath: openPath),
    theme: darkTheme(),
  ),
);

Future<void> settle(WidgetTester tester) async {
  await tester.pumpAndSettle();
  await tester.pumpAndSettle();
}

double rowHeight(WidgetTester tester, String name) => tester
    .getSize(
      find.ancestor(of: find.text(name), matching: find.byType(Row)).first,
    )
    .height;

void main() {
  testWidgets('a selected row is the same height as the others', (
    tester,
  ) async {
    // It was not: the actions button appears when a row is selected, and it was appearing into a
    // box that had no room reserved for it, so the row you were reading grew taller than the rows
    // around it and the whole list shifted under your eyes.
    tester.view.physicalSize = const Size(1400, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(_host(openPath: 'README.md'));
    await settle(tester);
    await tester.tap(find.byIcon(Icons.folder_outlined).first);
    await settle(tester);

    expect(rowHeight(tester, 'README.md'), rowHeight(tester, 'PLAN.md'));
  });

  testWidgets('a folder can be pointed at, so its actions are reachable', (
    tester,
  ) async {
    // On a phone there is no pointer to hover with, so "the row you last touched" is what says
    // which row you mean. Without it a folder's own menu could not be opened at all.
    await tester.pumpWidget(_host());
    await settle(tester);
    await tester.tap(find.byIcon(Icons.folder_outlined).first);
    await settle(tester);

    await tester.tap(find.text('notes'));
    await settle(tester);

    final row = find
        .ancestor(of: find.text('notes'), matching: find.byType(Row))
        .first;
    expect(
      find.descendant(of: row, matching: find.byIcon(Icons.more_horiz)),
      findsOneWidget,
    );
  });

  testWidgets('opening a document leaves the tree as it was', (tester) async {
    // Opening a document is a different route, so the widget holding the tree is rebuilt from
    // nothing. The expansion state used to live in it, and the first document anybody opened folded
    // the tree back up under them.
    tester.view.physicalSize = const Size(1400, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(_host());
    await settle(tester);
    await tester.tap(find.byIcon(Icons.folder_outlined).first);
    await settle(tester);
    await tester.tap(find.text('notes'));
    await settle(tester);
    expect(find.text('idea.md'), findsOneWidget);

    // The same screen, now with a document open beside it — which is what the route change does.
    await tester.pumpWidget(_host(openPath: 'README.md'));
    await settle(tester);

    expect(
      find.text('idea.md'),
      findsOneWidget,
      reason: 'the folder the reader opened is still open',
    );
  });
}
