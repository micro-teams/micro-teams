// The composer's shape: a field and a send button that are one control, not two.
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
  _Fake();

  /// Make everything except the conversation itself fail, the way a partial outage does.

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

    return ResponseBody.fromString(
      body,
      200,
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
  // The composer is a field and a button side by side, and they have to look like one control.
  // They did not: the field was 48 tall against a 40 tall button, and the eight pixels sat above
  // the text as a gap with nothing in it that no window size explained.
  for (final window in [
    (name: 'a phone', size: const Size(420, 800)),
    (name: 'a desktop', size: const Size(1280, 800)),
  ]) {
    testWidgets('the composer is one height on ${window.name}', (tester) async {
      tester.view.physicalSize = window.size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(_host(_Fake()));
      await tester.pumpAndSettle();

      final field = tester.getRect(find.byType(TextField));
      final button = tester.getRect(find.byType(FilledButton));
      expect(field.height, button.height);
      expect(field.top, button.top, reason: 'and they start at the same line');
      expect(field.bottom, button.bottom);
    });
  }
}
