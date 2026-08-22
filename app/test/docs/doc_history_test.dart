// A document's history, and the diff behind each entry.
//
// Documents are a git repository, so this is how a human finds out what an agent changed while they
// were away. In the React client it existed on the phone and not on the desktop — the surface where
// you would actually review a change — which is the asymmetry two shells produce and one shared
// screen cannot.

import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:microteams/src/auth/auth_api.dart';
import 'package:microteams/src/common/api.dart';
import 'package:microteams/src/common/config.dart';
import 'package:microteams/src/common/ui/theme.dart';
import 'package:microteams/src/docs/doc_history.dart';
import 'package:microteams/src/providers.dart';

class _Fake implements HttpClientAdapter {
  final List<String> asked = [];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    asked.add(options.uri.toString());
    const page =
        '"page":{"page_start":1,"page_size":100,"has_prev":false,"has_more":false}';
    final query = options.uri.queryParameters;

    final body = switch (options.uri.path) {
      '/mt/team' => '{"teams":[{"id":1,"name":"One"}],$page}',
      '/mt/team/1/document' when query['history'] == 'true' =>
        '{"path":"notes.md","isFolder":false,"history":['
            '{"sha":"abcdef1234567890","message":"agent3 wrote it down",'
            '"author":"agent3","timestamp":1787580000000}]}',
      '/mt/team/1/document' when query['diff'] != null =>
        '{"path":"notes.md","isFolder":false,'
            '"diff":"--- a/notes.md\\n+++ b/notes.md\\n@@ -1 +1 @@\\n-old\\n+new"}',
      _ => '{"path":"notes.md","isFolder":false,"content":"new"}',
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
    home: const Scaffold(body: DocHistory(path: 'notes.md')),
  ),
);

Future<void> settle(WidgetTester tester) async {
  await tester.pumpAndSettle();
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('lists what changed, who changed it and when', (tester) async {
    final backend = _Fake();
    await tester.pumpWidget(_host(backend));
    await settle(tester);

    expect(find.text('agent3 wrote it down'), findsOneWidget);
    // The short sha, the author and a readable time — not an epoch, which is a number nobody reads.
    expect(find.textContaining('abcdef1'), findsOneWidget);
    expect(find.textContaining('agent3 ·'), findsOneWidget);
    expect(find.textContaining('1787580000000'), findsNothing);
  });

  testWidgets('a commit opens the diff behind it', (tester) async {
    final backend = _Fake();
    await tester.pumpWidget(_host(backend));
    await settle(tester);

    await tester.tap(find.text('agent3 wrote it down'));
    await settle(tester);

    expect(find.textContaining('diff abcdef1'), findsOneWidget);
    expect(find.text('+new'), findsOneWidget);
    expect(find.text('-old'), findsOneWidget);
    expect(
      backend.asked.where((a) => a.contains('diff=abcdef1234567890')),
      isNotEmpty,
    );
  });

  testWidgets('the file headers are not coloured as changes', (tester) async {
    // `+++` and `---` are which file this is, not an added and a removed line. Colouring them as
    // changes makes a diff of one file look like a diff of three.
    final backend = _Fake();
    await tester.pumpWidget(_host(backend));
    await settle(tester);
    await tester.tap(find.text('agent3 wrote it down'));
    await settle(tester);

    Color colourOf(String line) =>
        tester.widget<Text>(find.text(line)).style!.color!;

    expect(colourOf('+new'), isNot(colourOf('-old')));
    expect(colourOf('+++ b/notes.md'), colourOf('--- a/notes.md'));
    expect(colourOf('+++ b/notes.md'), isNot(colourOf('+new')));
  });
}
