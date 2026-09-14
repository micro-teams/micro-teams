// Whose message is whose.
//
// This is the assertion the first Flutter cut would have failed, and it failed invisibly: the code
// DID align own messages to the right, but capped a bubble at a flat 560px — wider than a phone —
// so every bubble filled its row and both sides looked identically left-aligned. Reading the code
// said "correct". Only a measurement says otherwise, so this test measures.
//
// It also pins the two colours. They are shared with the React client on purpose (see
// ui/theme.dart), and "the green went slightly off" is not something anyone notices in review.

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:microteams/src/providers.dart';
import 'package:microteams/src/auth/auth_api.dart';
import 'package:microteams/src/common/config.dart';
import 'package:microteams/src/chats/thread_screen.dart';
import 'package:microteams/src/common/api.dart';
import 'package:microteams/src/common/ui/theme.dart';

/// A conversation between user 1 (us, see the session override below) and user 2.
class _TwoPeople implements HttpClientAdapter {
  _TwoPeople({this.theirs = 'theirs'});

  /// What the other person said. A test that cares about how text is laid out says so here.
  final String theirs;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    // Keyed on the path. The conversation asks three questions now — messages, the roster, and
    // which of those members are agents — and a fake that answers them all with the same shape is
    // a fake that would let a mis-parse pass.
    if (options.uri.path.endsWith('/agent')) {
      return ResponseBody.fromString(
        '{"agents":[],"page":{"page_start":0,"page_size":50,'
        '"has_prev":false,"has_more":false}}',
        200,
        headers: {
          Headers.contentTypeHeader: [Headers.jsonContentType],
        },
      );
    }
    final json = options.uri.path.endsWith('/messages')
        ? '{"messages":['
              '{"id":1,"threadId":7,"senderId":2,"content":"$theirs",'
              '"createdAt":"2026-08-20T09:00:00Z"},'
              '{"id":2,"threadId":7,"senderId":1,"content":"mine",'
              '"createdAt":"2026-08-20T09:01:00Z"}'
              '],"page":{"page_start":2,"page_size":100,"has_prev":false,'
              '"has_more":false}}'
        : '{"thread":{"id":7,"title":"","createdAt":"2026-08-20T00:00:00Z"},'
              '"members":['
              '{"id":1,"threadId":7,"userId":1,"role":"OWNER",'
              '"joinedAt":"2026-08-20T00:00:00Z","nickname":"me"},'
              '{"id":2,"threadId":7,"userId":2,"role":"MEMBER",'
              '"joinedAt":"2026-08-20T00:00:00Z","nickname":"them"}'
              ']}';
    return ResponseBody.fromString(
      json,
      200,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

/// Signed in as user 1, without a server to sign in against. Which side a bubble goes on is
/// decided by comparing a sender to "me", so a test that does not say who it is tests nothing.
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

Future<void> _pumpThread(
  WidgetTester tester, {
  bool asPane = false,
  String theirs = 'theirs',
}) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        sessionProvider.overrideWith(_SignedIn.new),
        endpointsProvider.overrideWithValue(
          const Endpoints(origin: 'http://backend.test'),
        ),
        mtClientProvider.overrideWithValue(
          MtClient(
            baseUrl: 'http://backend.test/mt',
            reauthorize: () async => null,
            adapter: _TwoPeople(theirs: theirs),
          ),
        ),
      ],
      child: MaterialApp(
        theme: darkTheme(),
        home: ThreadScreen(threadId: 7, asPane: asPane),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

/// The bubble's background, found by walking up from its text to the first painted box.
Color _bubbleColourOf(WidgetTester tester, String text) {
  final container = tester.widget<Container>(
    find.ancestor(of: find.text(text), matching: find.byType(Container)).first,
  );
  return (container.decoration! as BoxDecoration).color!;
}

void main() {
  testWidgets('own messages sit right, other people left', (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    await _pumpThread(tester);

    final mine = tester.getRect(find.text('mine'));
    final theirs = tester.getRect(find.text('theirs'));
    final middle = 390 / 2;

    expect(mine.center.dx, greaterThan(middle), reason: 'own message is right');
    expect(
      theirs.center.dx,
      lessThan(middle),
      reason: "the other person's message is left",
    );
  });

  testWidgets('the greens are the ones the React client used', (tester) async {
    await _pumpThread(tester);

    expect(_bubbleColourOf(tester, 'mine'), ownBubble);
    expect(_bubbleColourOf(tester, 'theirs'), otherBubble);
  });

  testWidgets('the conversation is named after the other person', (
    tester,
  ) async {
    await _pumpThread(tester);

    // The thread has no title of its own, and "Conversation" is not a name.
    expect(find.text('them'), findsWidgets);
    expect(find.text('Conversation'), findsNothing);
  });
}
