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
import 'package:microteams/src/common/ui/avatar.dart';
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

  testWidgets('message text can be selected, and the system copies it', (
    tester,
  ) async {
    // Copying used to be "long-press the bubble, get the whole thing". That cannot copy half a
    // message, or one line out of an agent's reply, which is most of what people copy here. So the
    // list is a selection area and the system's own copy does the copying — see the measurement in
    // thread_screen.dart for what that costs.
    await _pumpThread(tester);

    expect(
      find.byType(SelectionArea),
      findsOneWidget,
      reason: 'one area around the list, so a drag runs across bubbles',
    );

    final selectable = find.descendant(
      of: find.byType(SelectionArea),
      matching: find.text('mine'),
    );
    expect(selectable, findsOneWidget);
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

  testWidgets('the composer and its button are the same height', (
    tester,
  ) async {
    // Two controls side by side at different heights is the sort of thing you cannot stop seeing
    // once you have seen it, and it is invisible in code review — the numbers agree, the rendered
    // boxes do not, because a TextField's height is its padding plus a line of text and a button's
    // is whatever it was told.
    await _pumpThread(tester);

    final field = tester.getSize(find.byType(TextField));
    final button = tester.getSize(find.widgetWithText(FilledButton, 'send'));
    expect(
      button.height,
      field.height,
      reason: 'send is ${button.height}, the field is ${field.height}',
    );
  });

  testWidgets('the conversation is named after the other person', (
    tester,
  ) async {
    await _pumpThread(tester);

    // The thread has no title of its own, and "Conversation" is not a name.
    expect(find.text('them'), findsWidgets);
    expect(find.text('Conversation'), findsNothing);
  });

  testWidgets('a run of unbreakable text stays inside its bubble', (
    tester,
  ) async {
    // T-011. On the React side this needed `wrap-anywhere`, because CSS will not break inside a
    // word and a pasted URL or a base64 blob simply ran out of the bubble and across the screen.
    // Flutter breaks by character when a word cannot fit — this measures that rather than assuming
    // it, because the failure is the same either way and it is not visible in code review.
    const wall =
        'A123456789B123456789C123456789D123456789E123456789'
        'F123456789G123456789H123456789I123456789J123456789';
    await _pumpThread(tester, theirs: wall);

    final bubble = tester.getSize(
      find
          .ancestor(of: find.text(wall), matching: find.byType(Container))
          .first,
    );
    final screen =
        tester.view.physicalSize.width / tester.view.devicePixelRatio;
    expect(
      bubble.width,
      lessThanOrEqualTo(screen * 0.75),
      reason:
          'a bubble is capped at a share of the row; the text wraps inside it',
    );
  });

  testWidgets('the newest message is the one you are looking at', (
    tester,
  ) async {
    // T-014 / T-016 in their calm form: the list is REVERSED, so the newest message is at offset
    // zero and a message arriving does not move a reader who has scrolled up — there is no
    // pin-to-bottom rule to get wrong, because there is nothing to pin.
    await _pumpThread(tester);

    final list = tester.widget<ListView>(find.byType(ListView));
    expect(list.reverse, isTrue);
    expect(
      list.controller?.position.pixels,
      0,
      reason:
          'zero is the bottom in a reversed list — where the newest message is',
    );
  });
}
