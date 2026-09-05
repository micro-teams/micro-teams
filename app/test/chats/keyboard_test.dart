// The soft keyboard must not move the conversation.
//
// Tapping the composer used to slide every bubble upward: the scaffold resized itself, the list is
// anchored at the bottom, so the messages you were reading jumped by the height of the keyboard —
// and jumped back when it closed. What the eye holds still by is the title bar, so that is what the
// bubbles are measured against here.

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:microteams/src/auth/auth_api.dart';
import 'package:microteams/src/chats/thread_screen.dart';
import 'package:microteams/src/common/api.dart';
import 'package:microteams/src/common/config.dart';
import 'package:microteams/src/providers.dart';

class _Fake implements HttpClientAdapter {
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    const page =
        '"page":{"page_start":1,"page_size":50,"has_prev":false,"has_more":false}';
    final body = switch ('${options.method} ${options.uri.path}') {
      'GET /mt/chat/5' =>
        '{"thread":{"id":5,"title":"standup","createdAt":"2026-08-20T00:00:00Z"},'
            '"members":[{"id":1,"threadId":5,"userId":1,"role":"OWNER",'
            '"joinedAt":"2026-08-20T00:00:00Z","nickname":"Me"}]}',
      // Enough to fill the screen and then some, so there is history to scroll into: a
      // conversation shorter than the window has nowhere to take the space from.
      'GET /mt/chat/5/messages' =>
        '{"messages":[${[for (var i = 1; i <= 30; i++) '{"id":$i,"threadId":5,"senderId":1,"content":"message $i",'
              '"createdAt":"2026-08-21T00:${i.toString().padLeft(2, '0')}:00Z"}'].join(',')}],$page}',
      'GET /mt/team' => '{"teams":[{"id":1,"name":"Team One"}],$page}',
      'GET /mt/agent' => '{"agents":[],$page}',
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

/// The screen, with a keyboard whose height the test can change under it — the same tree
/// throughout, because opening a keyboard does not rebuild the app.
Widget _host(ValueListenable<double> keyboard) => ProviderScope(
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
    home: ValueListenableBuilder<double>(
      valueListenable: keyboard,
      builder: (context, height, _) => MediaQuery(
        // The ambient one with a keyboard added, rather than a fresh one: a bare MediaQueryData has
        // a size of zero, and a screen with no size lays nothing out.
        data: MediaQuery.of(
          context,
        ).copyWith(viewInsets: EdgeInsets.only(bottom: height)),
        child: const ThreadScreen(threadId: 5),
      ),
    ),
  ),
);

void main() {
  testWidgets('a window that shrinks does not move the messages either', (
    tester,
  ) async {
    // The other way a keyboard arrives: on Android the window itself gets smaller, with no inset to
    // read. The list is anchored at its bottom, so without help every bubble slides up by the
    // height of the keyboard — which is exactly what was reported on a phone after the inset-only
    // fix shipped.
    tester.view.physicalSize = const Size(400, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final keyboard = ValueNotifier<double>(0);
    addTearDown(keyboard.dispose);
    await tester.pumpWidget(_host(keyboard));
    await tester.pumpAndSettle();

    // Somewhere in the middle of the history, so there is room on both sides of it.
    await tester.drag(find.text('message 30'), const Offset(0, 120));
    await tester.pumpAndSettle();

    // A window gets shorter because somebody tapped the field, so that is how the test gets there:
    // the list holds its height while the composer has focus, and only then.
    await tester.tap(find.byType(TextField));
    await tester.pumpAndSettle();

    final title = tester.getRect(find.byType(AppBar));
    double belowTitle() =>
        tester.getTopLeft(find.text('message 20')).dy - title.bottom;
    final before = belowTitle();
    final listHeight = tester.getSize(find.byType(ListView)).height;

    tester.view.physicalSize = const Size(400, 500);
    await tester.pumpAndSettle();

    expect(belowTitle(), closeTo(before, 0.5));

    // And it got there without moving through anywhere else: the list was never re-laid-out, so
    // there is no correction to see. A frame taken part-way through would show the same number.
    await tester.pump(const Duration(milliseconds: 16));
    expect(belowTitle(), closeTo(before, 0.5));
    expect(
      tester.getSize(find.byType(ListView)).height,
      closeTo(listHeight, 0.5),
      reason:
          'the list keeps its height and overflows behind the keyboard, rather '
          'than being re-laid-out and scrolled back',
    );
  });

  testWidgets('the keyboard opening does not move the messages', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(400, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final keyboard = ValueNotifier<double>(0);
    addTearDown(keyboard.dispose);
    await tester.pumpWidget(_host(keyboard));
    await tester.pumpAndSettle();

    await tester.tap(find.byType(TextField));
    await tester.pumpAndSettle();

    final title = tester.getRect(find.byType(AppBar));
    double bubbleBelowTitle() =>
        tester.getTopLeft(find.text('message 20')).dy - title.bottom;
    final before = bubbleBelowTitle();

    keyboard.value = 300;
    await tester.pumpAndSettle();

    expect(bubbleBelowTitle(), closeTo(before, 0.5));
    expect(
      tester.getRect(find.byType(TextField)).bottom,
      lessThanOrEqualTo(800 - 300 + 0.5),
      reason: 'and the composer is above the keyboard, not behind it',
    );
  });

  // Holding the list still has a cost, and this is where it falls due: the newest messages are now
  // behind the keyboard, and the list has no more room to give, so no amount of dragging brings
  // them out. Reported from a phone as "the messages do not move any more, but I cannot scroll
  // down either" — and the second half is the bug.
  testWidgets('what the keyboard covers can still be scrolled into view', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(400, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final keyboard = ValueNotifier<double>(0);
    addTearDown(keyboard.dispose);
    await tester.pumpWidget(_host(keyboard));
    await tester.pumpAndSettle();

    keyboard.value = 300;
    await tester.pumpAndSettle();

    // Drag towards the newest and then look for the last message somewhere a person could see it.
    // A reversed list counts its offset away from the newest, so that is an upward drag here.
    await tester.drag(find.byType(ListView), const Offset(0, -400));
    await tester.pumpAndSettle();

    expect(
      tester.getRect(find.text('message 30')).bottom,
      lessThanOrEqualTo(800 - 300 + 0.5),
      reason:
          'the newest message cannot be brought out from behind the keyboard',
    );
  });

  // The other half of the report — "sometimes", and this is the sometimes. Two things happen when a
  // keyboard goes away, and nothing says which comes first: the field loses focus, and the window
  // grows back. Arriving in that order, the height is unfrozen while the window is still short, so
  // the list is re-laid-out at the short height and every bubble moves — and then moves again when
  // the window grows. Arriving the other way round, nothing is visible. That is the whole of "it
  // only happens sometimes".
  testWidgets('losing focus before the window grows back moves nothing', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(400, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final keyboard = ValueNotifier<double>(0);
    addTearDown(keyboard.dispose);
    await tester.pumpWidget(_host(keyboard));
    await tester.pumpAndSettle();

    await tester.tap(find.byType(TextField));
    await tester.pumpAndSettle();
    tester.view.physicalSize = const Size(400, 500);
    await tester.pumpAndSettle();

    final title = tester.getRect(find.byType(AppBar));
    double belowTitle() =>
        tester.getTopLeft(find.text('message 20')).dy - title.bottom;
    final before = belowTitle();

    // The keyboard goes away: focus first, window second — the order that shows the bug.
    FocusManager.instance.primaryFocus?.unfocus();
    await tester.pumpAndSettle();
    expect(
      belowTitle(),
      closeTo(before, 0.5),
      reason: 'the messages moved while the window was still short',
    );

    tester.view.physicalSize = const Size(400, 800);
    await tester.pumpAndSettle();
    expect(belowTitle(), closeTo(before, 0.5));
  });

  testWidgets('the keyboard closing does not move the messages either', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(400, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final keyboard = ValueNotifier<double>(0);
    addTearDown(keyboard.dispose);
    await tester.pumpWidget(_host(keyboard));
    await tester.pumpAndSettle();

    keyboard.value = 300;
    await tester.pumpAndSettle();
    // A reader who has scrolled up into the history, which is when a jump is most obvious — and
    // upwards is a POSITIVE drag here, because a reversed list counts its offset away from the
    // newest. (Scrolled the other way, down into the strip the keyboard is covering, something has
    // to move when that strip stops existing: the list is anchored at its bottom, so the newest
    // message follows the bottom edge down. That is the layout being honest, not a jump.)
    await tester.drag(find.byType(ListView), const Offset(0, 400));
    await tester.pumpAndSettle();

    final title = tester.getRect(find.byType(AppBar));
    double bubbleBelowTitle() =>
        tester.getTopLeft(find.text('message 20')).dy - title.bottom;
    final before = bubbleBelowTitle();

    keyboard.value = 0;
    await tester.pumpAndSettle();

    expect(bubbleBelowTitle(), closeTo(before, 0.5));
  });
}
