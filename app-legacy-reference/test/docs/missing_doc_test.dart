// What is shown where a document would be, when the document is not there any more.
//
// Somebody deletes or renames a file while its address is still open in another window — the
// ordinary case, not an exotic one. It used to print the backend's exception in the middle of the
// screen: it named no file, offered no way on, and left the reader at a dead end with the tree one
// tap away and nothing saying so.

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
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    const page =
        '"page":{"page_start":1,"page_size":100,"has_prev":false,"has_more":false}';
    // The tree is fine; the one file is gone. That is exactly the state this is about.
    final wantsContent = options.uri.queryParameters['content'] == 'true';
    if (options.uri.path == '/mt/team/1/document' && wantsContent) {
      return ResponseBody.fromString(
        '{"code":404,"message":"file not found in git: notes/idea.md"}',
        404,
        headers: {
          Headers.contentTypeHeader: [Headers.jsonContentType],
        },
      );
    }
    final body = switch (options.uri.path) {
      '/mt/team' => '{"teams":[{"id":1,"name":"One"}],$page}',
      '/mt/team/1/document' =>
        '{"path":"","isFolder":true,"children":['
            '{"path":"notes/idea.md","isFolder":false}]}',
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

Widget _host({required void Function(String?) onOpen}) => ProviderScope(
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
  child: MaterialApp(
    theme: darkTheme(),
    home: DocsScreen(
      onManageTeams: () {},
      onOpen: onOpen,
      openPath: 'notes/idea.md',
    ),
  ),
);

void main() {
  testWidgets(
    'a document that is gone says which one, and offers the way back',
    (tester) async {
      String? closedTo = 'not called';
      await tester.pumpWidget(_host(onOpen: (path) => closedTo = path));
      await tester.pumpAndSettle();
      await tester.pumpAndSettle();

      expect(find.textContaining('notes/idea.md'), findsWidgets);
      expect(find.textContaining('not in the tree any more'), findsOneWidget);
      // Not the backend's word for it.
      expect(find.textContaining('MtError'), findsNothing);

      await tester.tap(find.text('back to the tree'));
      await tester.pumpAndSettle();
      expect(
        closedTo,
        isNull,
        reason: 'closing the file goes back to the tree',
      );
    },
  );
}
