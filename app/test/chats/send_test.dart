// Pressing send has to send.
//
// There was no test for this — every test around the outbox drove the queue directly, and the one
// path nobody covered is the one a person actually uses: type into the composer, press the button.

import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:microteams/src/auth/auth_api.dart';
import 'package:microteams/src/chats/thread_screen.dart';
import 'package:microteams/src/common/api.dart';
import 'package:microteams/src/common/config.dart';
import 'package:microteams/src/providers.dart';

class _Fake implements HttpClientAdapter {
  _Fake({this.breakExtras = false});

  /// Make everything except the conversation itself fail, the way a partial outage does.
  final bool breakExtras;

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
        '"page":{"page_start":1,"page_size":50,"has_prev":false,"has_more":false}';
    final body = switch (call) {
      'GET /mt/chat/5' =>
        '{"thread":{"id":5,"title":"standup","createdAt":"2026-08-20T00:00:00Z"},'
            '"members":[{"id":1,"threadId":5,"userId":1,"role":"OWNER",'
            '"joinedAt":"2026-08-20T00:00:00Z","nickname":"Me"}]}',
      'GET /mt/chat/5/messages' => '{"messages":[],$page}',
      'GET /mt/team' => '{"teams":[{"id":1,"name":"Team One"}],$page}',
      'GET /mt/agent' => '{"agents":[],$page}',
      'POST /mt/chat/5/messages' => jsonEncode({
        'id': 91,
        'threadId': 5,
        'senderId': 1,
        'content': 'hello',
        'createdAt': '2026-08-21T00:00:00Z',
        'clientToken': _tokenOf(options.data),
      }),
      _ => '{}',
    };

    final failing = breakExtras && !options.uri.path.startsWith('/mt/chat/5');

    return ResponseBody.fromString(
      failing ? '{"message":"nope"}' : body,
      failing ? 500 : 200,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  static String? _tokenOf(Object? data) {
    if (data is! String) return null;
    final decoded = jsonDecode(data);
    return decoded is Map ? decoded['clientToken'] as String? : null;
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
  child: const MaterialApp(home: ThreadScreen(threadId: 5)),
);

void main() {
  testWidgets('a conversation still sends when the extras fail', (
    tester,
  ) async {
    // Presence and the roster are decoration: they put a face beside a bubble and a ring around an
    // agent. Neither is allowed to take the conversation down with it — which is exactly what used
    // to happen, because reading `.value` on a provider that has FAILED rethrows the failure, and
    // the throw happened while building the screen. The composer went with it.
    final backend = _Fake(breakExtras: true);
    await tester.pumpWidget(_host(backend));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), 'hello');
    await tester.tap(find.widgetWithText(FilledButton, 'send'));
    await tester.pumpAndSettle();

    expect(
      backend.wrote.map((w) => w.call),
      contains('POST /mt/chat/5/messages'),
    );
  });

  testWidgets('typing and pressing send posts the message', (tester) async {
    final backend = _Fake();
    await tester.pumpWidget(_host(backend));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), 'hello');
    await tester.tap(find.widgetWithText(FilledButton, 'send'));
    await tester.pumpAndSettle();

    expect(
      backend.wrote.map((w) => w.call),
      contains('POST /mt/chat/5/messages'),
    );
    expect(find.text('hello'), findsOneWidget);
  });

  testWidgets('the composer is emptied, and the message is on screen', (
    tester,
  ) async {
    final backend = _Fake();
    await tester.pumpWidget(_host(backend));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), 'hello');
    await tester.tap(find.widgetWithText(FilledButton, 'send'));
    await tester.pumpAndSettle();

    expect(
      tester.widget<TextField>(find.byType(TextField)).controller?.text,
      '',
    );
    expect(find.text('hello'), findsOneWidget);
  });
}
