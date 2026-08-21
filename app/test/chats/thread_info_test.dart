// A conversation's membership, and the two rules in it that are not layout.
//
// Both were in the React client and neither is obvious from the endpoints: who may change the
// roster, and who may not be taken out of it. Getting either wrong is only visible as a button
// somebody presses and then has to explain.

import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:microteams/src/auth/auth_api.dart';
import 'package:microteams/src/chats/new_chat_dialog.dart';
import 'package:microteams/src/chats/thread_info_screen.dart';
import 'package:microteams/src/common/api.dart';
import 'package:microteams/src/common/config.dart';
import 'package:microteams/src/providers.dart';

class _Fake implements HttpClientAdapter {
  _Fake({this.myRole = 'OWNER'});

  /// What the signed-in human is in this conversation.
  final String myRole;

  final List<String> wrote = [];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final call = '${options.method} ${options.uri.path}';
    if (options.method != 'GET') wrote.add(call);

    final body = switch (call) {
      'GET /mt/chat/5' => jsonEncode({
        'thread': {
          'id': 5,
          'title': 'standup',
          'createdAt': '2026-08-20T00:00:00Z',
        },
        // The whole record the contract says a member is — a fake that sends less passes a test
        // the real server would fail.
        'members': [
          for (final m in [
            (id: 1, nickname: 'Me', role: myRole),
            (id: 2, nickname: 'Owner', role: 'OWNER'),
            (id: 3, nickname: 'Them', role: 'MEMBER'),
          ])
            {
              'id': m.id,
              'threadId': 5,
              'userId': m.id,
              'role': m.role,
              'joinedAt': '2026-08-20T00:00:00Z',
              'nickname': m.nickname,
            },
        ],
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
  child: MaterialApp(home: child),
);

void main() {
  group('member ids', () {
    test('are read from whatever separators somebody typed', () {
      expect(parseMemberIds('12, 34 56'), [12, 34, 56]);
    });

    test('drop what is not a number rather than refusing the lot', () {
      // The field accepts what was pasted; a trailing comma is not worth stopping a person for.
      expect(parseMemberIds('12,,  x 34,'), [12, 34]);
    });

    test('an empty field is a chat with nobody else in it, not an error', () {
      expect(parseMemberIds('   '), isEmpty);
    });
  });

  group('the roster', () {
    testWidgets('shows everyone in it', (tester) async {
      await tester.pumpWidget(
        _host(_Fake(), ThreadInfoScreen(threadId: 5, onGone: () {})),
      );
      await tester.pumpAndSettle();

      expect(find.text('Me'), findsOneWidget);
      expect(find.text('Owner'), findsOneWidget);
      expect(find.text('Them'), findsOneWidget);
    });

    testWidgets('offers nothing to change while you are only a member', (
      tester,
    ) async {
      await tester.pumpWidget(
        _host(
          _Fake(myRole: 'MEMBER'),
          ThreadInfoScreen(threadId: 5, onGone: () {}),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('add'), findsNothing);
      expect(find.text('Rename chat'), findsNothing);
      expect(find.text('Delete this chat'), findsNothing);
      expect(find.byTooltip('Remove user 3'), findsNothing);
    });

    testWidgets('an owner may take out anyone except themselves and an owner', (
      tester,
    ) async {
      await tester.pumpWidget(
        _host(_Fake(), ThreadInfoScreen(threadId: 5, onGone: () {})),
      );
      await tester.pumpAndSettle();

      // Leaving is a different act from being taken out, and it does not exist yet — so there is
      // no button on yourself, and none on the other owner.
      expect(find.byTooltip('Remove user 3'), findsOneWidget);
      expect(find.byTooltip('Remove user 1'), findsNothing);
      expect(find.byTooltip('Remove user 2'), findsNothing);
    });

    testWidgets(
      'removing somebody asks the server, then asks again who is in',
      (tester) async {
        final backend = _Fake();
        await tester.pumpWidget(
          _host(backend, ThreadInfoScreen(threadId: 5, onGone: () {})),
        );
        await tester.pumpAndSettle();

        await tester.tap(find.byTooltip('Remove user 3'));
        await tester.pumpAndSettle();

        expect(backend.wrote, contains('DELETE /mt/chat/5/members/3'));
      },
    );

    testWidgets('deleting the whole conversation needs confirming', (
      tester,
    ) async {
      final backend = _Fake();
      var gone = false;
      await tester.pumpWidget(
        _host(
          backend,
          ThreadInfoScreen(threadId: 5, onGone: () => gone = true),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Delete this chat'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(
        backend.wrote.where((w) => w.startsWith('DELETE /mt/chat/5')),
        isEmpty,
      );
      expect(gone, isFalse);

      await tester.tap(find.text('Delete this chat'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, 'Delete'));
      await tester.pumpAndSettle();
      expect(backend.wrote, contains('DELETE /mt/chat/5'));
      expect(gone, isTrue);
    });
  });
}
