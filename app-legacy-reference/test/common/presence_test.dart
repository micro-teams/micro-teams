// Whether an avatar knows it is an agent, which is what decides whether it can be tapped at all.
//
// The registry batches every tracked id into one request. What it used to do with a SECOND question
// while the first was still in the air was drop it — and nothing asked again, because only a change
// in the tracked set schedules a request. That is the app's first second in one sentence: a few
// avatars ask, thirty more mount while the answer is on its way, and every one of those ids stays
// unknown. An avatar that is not known to be an agent has no tap handler, so tapping one of those
// faces does nothing whatsoever — which is exactly what it looked like from the outside.

import 'dart:async';
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

class _Agents implements HttpClientAdapter {
  _Agents({this.failFirst = false});

  /// The first enumeration fails, the way one unlucky moment at startup does.
  final bool failFirst;

  final List<Set<int>> asked = [];
  Completer<void>? hold;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    const page =
        '"page":{"page_start":1,"page_size":50,"has_prev":false,"has_more":false}';
    if (options.uri.path != '/mt/agent') {
      return ResponseBody.fromString(
        '{"teams":[{"id":1,"name":"Team One"}],$page}',
        200,
        headers: {
          Headers.contentTypeHeader: [Headers.jsonContentType],
        },
      );
    }

    final ids = {
      for (final raw
          in options.uri.queryParametersAll['userId'] ?? const <String>[])
        int.parse(raw),
    };
    asked.add(ids);
    final first = asked.length == 1;
    // Held open, so a test can mount another avatar while this one is in flight.
    if (first && hold != null) await hold!.future;
    if (first && failFirst) {
      return ResponseBody.fromString(
        '{"message":"not now"}',
        500,
        headers: {
          Headers.contentTypeHeader: [Headers.jsonContentType],
        },
      );
    }
    return ResponseBody.fromString(
      '{"agents":[${[for (final id in ids) '{"userId":$id,"nickname":"agent$id","online":true,"sid":"s$id",'
            '"vars":{"status":"idle"}}'].join(',')}],$page}',
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

Widget _host(_Agents backend, Widget child) => ProviderScope(
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

/// Whether this avatar can be tapped, which is the app's way of saying "this is an agent".
bool _clickable(WidgetTester tester, int userId) => tester
    .widgetList<GestureDetector>(
      find.descendant(
        of: find.byWidget(
          tester
              .widgetList<UserAvatar>(find.byType(UserAvatar))
              .firstWhere((avatar) => avatar.userId == userId),
        ),
        matching: find.byType(GestureDetector),
      ),
    )
    .isNotEmpty;

void main() {
  testWidgets(
    'an avatar that mounts while a request is out still gets asked about',
    (tester) async {
      final backend = _Agents()..hold = Completer<void>();
      final shown = ValueNotifier<int>(1);
      addTearDown(shown.dispose);

      await tester.pumpWidget(
        _host(
          backend,
          ValueListenableBuilder<int>(
            valueListenable: shown,
            builder: (context, count, _) => Column(
              children: [
                for (var i = 0; i < count; i++) UserAvatar(userId: 42 + i),
              ],
            ),
          ),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));

      // The second face arrives while the first question is still unanswered.
      shown.value = 2;
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));
      backend.hold!.complete();
      await tester.pumpAndSettle();

      expect(
        backend.asked.any((ids) => ids.contains(43)),
        isTrue,
        reason:
            'the question asked while one was in flight must not be dropped',
      );
      expect(
        _clickable(tester, 43),
        isTrue,
        reason: 'so it is an agent, and tappable',
      );
    },
  );

  testWidgets('one failed enumeration is not the last word', (tester) async {
    final backend = _Agents(failFirst: true);

    await tester.pumpWidget(_host(backend, const UserAvatar(userId: 42)));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
    // Past the wait a failed attempt takes before asking again.
    await tester.pump(const Duration(seconds: 3));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    // Two things had to be fixed for this to hold: a failed attempt now asks again, and a rebuild
    // of the registry — which is what the team arriving looks like, and it cancels every pending
    // timer — now re-asks about whatever is already being watched. Either one alone leaves this
    // face unknown, which on screen is an avatar that cannot be tapped.
    expect(backend.asked.length, greaterThan(1), reason: 'it asked again');
    expect(_clickable(tester, 42), isTrue);
  });
}
