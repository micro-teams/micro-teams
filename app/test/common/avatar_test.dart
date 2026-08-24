// The avatar's rules, which are the React client's rules.
//
// An avatar is not a picture here: it is how you can tell an agent from a human, see that one is
// working, read what it has spent, and get to its live screen. All of that came from
// UserAvatar.tsx and MemberGrid.tsx, and copying the *look* while dropping the rules is how the
// two clients stopped being the same product.

import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:microteams/src/auth/auth_api.dart';
import 'package:microteams/src/common/api.dart';
import 'package:microteams/src/common/config.dart';
import 'package:microteams/src/common/ui/avatar.dart';
import 'package:microteams/src/providers.dart';

class _Fake implements HttpClientAdapter {
  _Fake({this.status = 'idle'});

  /// What the agent's screen says it is doing.
  final String status;

  final List<String> asked = [];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    asked.add('${options.method} ${options.uri}');
    const page =
        '"page":{"page_start":1,"page_size":50,"has_prev":false,"has_more":false}';
    final body = switch (options.uri.path) {
      '/mt/team' => '{"teams":[{"id":1,"name":"Team One"}],$page}',
      // 42 is an agent; 7 is not in the answer at all, which is how a human is recognised.
      '/mt/agent' =>
        '{"agents":[{"userId":42,"nickname":"agent3","online":true,"sid":"s1",'
            '"vars":{"status":"$status","elapsed":"2m","tokens":"31k"}}],$page}',
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
  child: MaterialApp(
    home: Scaffold(body: Center(child: child)),
  ),
);

void main() {
  group('a working agent', () {
    testWidgets('wears the ring', (tester) async {
      await tester.pumpWidget(
        _host(_Fake(status: 'busy'), const UserAvatar(userId: 42)),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));

      expect(find.byKey(const ValueKey('working-ring')), findsOneWidget);
    });

    testWidgets('says nothing while it is idle', (tester) async {
      // A ring that is always on says nothing at all.
      await tester.pumpWidget(
        _host(_Fake(status: 'idle'), const UserAvatar(userId: 42)),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));

      expect(find.byKey(const ValueKey('working-ring')), findsNothing);
    });

    testWidgets('counts starting and compacting as working too', (
      tester,
    ) async {
      for (final status in ['starting', 'compacting']) {
        await tester.pumpWidget(
          _host(_Fake(status: status), const UserAvatar(userId: 42)),
        );
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 50));
        expect(
          find.byKey(const ValueKey('working-ring')),
          findsOneWidget,
          reason: status,
        );
      }
    });
  });

  testWidgets('a human is not clickable, an agent always is', (tester) async {
    await tester.pumpWidget(
      _host(
        _Fake(),
        const Column(children: [UserAvatar(userId: 42), UserAvatar(userId: 7)]),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    // Which one, not how many: counting them would pass just as happily with the wiring inverted,
    // and inverted is the failure worth catching — a human's face is not a door.
    final agent = find.byWidgetPredicate(
      (widget) => widget is UserAvatar && widget.userId == 42,
    );
    final human = find.byWidgetPredicate(
      (widget) => widget is UserAvatar && widget.userId == 7,
    );
    expect(
      find.descendant(of: agent, matching: find.byType(GestureDetector)),
      findsOneWidget,
      reason:
          'an agent stays tappable even with nothing to open, so the tap '
          'can explain itself rather than looking dead',
    );
    expect(
      find.descendant(of: human, matching: find.byType(GestureDetector)),
      findsNothing,
    );
  });

  testWidgets('every face on screen is one question, not one each', (
    tester,
  ) async {
    // Thirty avatars in a list must not be thirty requests. The registry batches them.
    final backend = _Fake();
    await tester.pumpWidget(
      _host(
        backend,
        const Column(
          children: [
            UserAvatar(userId: 42),
            UserAvatar(userId: 7),
            UserAvatar(userId: 8),
          ],
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    final agentCalls = backend.asked.where((a) => a.contains('/mt/agent'));
    expect(agentCalls, hasLength(1), reason: agentCalls.join('\n'));
    expect(agentCalls.first, contains('userId=42'));
    expect(agentCalls.first, contains('userId=7'));
  });

  group("the group tile is WeChat's", () {
    test('a row that is not full is centred, not left-aligned', () {
      // This is the whole reason it reads as WeChat: three is one-over-two, five is two-over-three.
      expect(MemberGridAvatar.rowsFor(1), [1]);
      expect(MemberGridAvatar.rowsFor(2), [2]);
      expect(MemberGridAvatar.rowsFor(3), [1, 2]);
      expect(MemberGridAvatar.rowsFor(4), [2, 2]);
      expect(MemberGridAvatar.rowsFor(5), [2, 3]);
      expect(MemberGridAvatar.rowsFor(6), [3, 3]);
      expect(MemberGridAvatar.rowsFor(7), [1, 3, 3]);
      expect(MemberGridAvatar.rowsFor(8), [2, 3, 3]);
      expect(MemberGridAvatar.rowsFor(9), [3, 3, 3]);
    });

    testWidgets('nine faces, not four', (tester) async {
      final members = [
        for (var id = 1; id <= 12; id++)
          (userId: id, nickname: 'user$id', avatarId: null),
      ];
      await tester.pumpWidget(
        _host(_Fake(), MemberGridAvatar(members: members, size: 48)),
      );
      await tester.pump();
      // Past the registry's one-frame coalescing, or the test ends with its timer still pending.
      await tester.pump(const Duration(milliseconds: 50));

      expect(
        find.byType(UserAvatar),
        findsNWidgets(9),
        reason: 'up to nine — a four-tile group avatar is a different product',
      );
    });
  });
}
