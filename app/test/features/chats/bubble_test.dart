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
import 'package:microteams/src/app_providers.dart';
import 'package:microteams/src/auth/auth_api.dart';
import 'package:microteams/src/core/cache.dart';
import 'package:microteams/src/core/config.dart';
import 'package:microteams/src/features/chats/thread_screen.dart';
import 'package:microteams/src/mt/client.dart';
import 'package:microteams/src/ui/avatar.dart';
import 'package:microteams/src/ui/theme.dart';

/// A conversation between user 1 (us, see the session override below) and user 2.
class _TwoPeople implements HttpClientAdapter {
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
              '{"id":1,"threadId":7,"senderId":2,"content":"theirs",'
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

Future<void> _pumpThread(WidgetTester tester, {bool asPane = false}) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        sessionProvider.overrideWith(_SignedIn.new),
        endpointsProvider.overrideWithValue(
          const Endpoints(origin: 'http://backend.test'),
        ),
        cacheProvider.overrideWithValue(ReadCache.inMemory()),
        mtClientProvider.overrideWithValue(
          MtClient(
            baseUrl: 'http://backend.test/mt',
            reauthorize: () async => null,
            adapter: _TwoPeople(),
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
  testWidgets('a bubble does not span the screen, so sides are visible', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    await _pumpThread(tester);

    for (final text in ['mine', 'theirs']) {
      final width = tester.getSize(find.text(text)).width;
      expect(
        width,
        lessThan(390 * 0.72),
        reason: '"$text" is as wide as the row — nothing can look aligned',
      );
    }
  });

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

  testWidgets('holding a message copies it', (tester) async {
    // There is no live text selection over the list — see the measurement in thread_screen.dart.
    // This gesture is the whole of how a message gets copied, so it is worth an assertion.
    String? copied;
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      SystemChannels.platform,
      (call) async {
        if (call.method == 'Clipboard.setData') {
          copied = (call.arguments as Map)['text'] as String?;
        }
        return null;
      },
    );
    addTearDown(
      () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform,
        null,
      ),
    );

    await _pumpThread(tester);
    await tester.longPress(find.text('mine'));
    await tester.pump();

    expect(copied, 'mine');
    expect(find.text('copied'), findsOneWidget);
  });

  testWidgets('a conversation beside the list is not something you entered', (
    tester,
  ) async {
    // Picking a different conversation on a wide window is picking, not navigating. Material adds
    // a back arrow whenever the router COULD pop, which is a fact about the history stack and not
    // about the layout — so it has to be turned off explicitly, and therefore asserted.
    await _pumpThread(tester, asPane: true);
    expect(find.byType(BackButton), findsNothing);
    expect(find.byIcon(Icons.arrow_back), findsNothing);
  });

  testWidgets('there are exactly two avatar sizes, and these are they', (
    tester,
  ) async {
    // One control, two measured sizes — 48 in the chat list, 40 beside a bubble, both taken from
    // the React client. They drifted apart once already.
    await _pumpThread(tester);
    final avatars = tester.widgetList<UserAvatar>(find.byType(UserAvatar));
    expect(avatars, isNotEmpty);
    for (final avatar in avatars) {
      expect(avatar.size, Metrics.avatarInBubble);
    }
    expect(Metrics.avatarInBubble, 40);
    expect(Metrics.avatarInList, 48);
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
