// Signing out has to reach the server, and the server has to know who is signing out.
//
// The endpoint is authenticated: called without the access token it answers 401, the refresh cookie
// lives on, and the next boot refreshes straight back into the session that was just ended. Locally
// it looks like a logout; one reload later it is undone. That is the bug this file watches for.

import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:microteams/src/app.dart';
import 'package:microteams/src/common/api.dart';
import 'package:microteams/src/common/config.dart';
import 'package:microteams/src/providers.dart';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:microteams/src/auth/auth_api.dart';
import 'package:microteams/src/common/errors.dart';
import 'package:microteams/src/common/key_value.dart';

class _Auth implements HttpClientAdapter {
  final List<RequestOptions> asked = [];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    asked.add(options);
    // What cheese-auth answers a caller with no token, which is what we used to be.
    final sent = '${options.headers['Authorization'] ?? ''}'.trim();
    final unauthorized = sent.isEmpty || sent == 'Bearer';
    return ResponseBody.fromString(
      unauthorized
          ? '{"code":401,"message":"Authentication required"}'
          : '{"code":200,"data":null}',
      unauthorized ? 401 : 200,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

/// A backend that answers the little the shell asks on the way to the profile.
class _Backend implements HttpClientAdapter {
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    const page =
        '"page":{"page_start":1,"page_size":50,"has_prev":false,"has_more":false}';
    final body = switch (options.uri.path) {
      '/mt/team' => '{"teams":[{"id":1,"name":"Team One"}],$page}',
      '/mt/chat' => '{"chats":[],$page}',
      '/mt/agent' => '{"agents":[],$page}',
      '/mt/machine' => '{"machines":[],$page}',
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

/// An identity service that agrees to everything.
class _Agreeable implements AuthApi {
  bool asked = false;

  @override
  Future<void> logout(String accessToken) async {
    asked = true;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError(
    '${invocation.memberName} is not part of this test',
  );
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
    accessToken: 'the-token',
  );
}

Widget _app(_Agreeable auth) => ProviderScope(
  overrides: [
    sessionProvider.overrideWith(_SignedIn.new),
    authApiProvider.overrideWithValue(auth),
    endpointsProvider.overrideWithValue(
      const Endpoints(origin: 'http://backend.test'),
    ),
    mtClientProvider.overrideWithValue(
      MtClient(
        baseUrl: 'http://backend.test/mt',
        reauthorize: () async => null,
        adapter: _Backend(),
      ),
    ),
  ],
  child: const MicroTeamsApp(),
);

void main() {
  test(
    'logging out is signed, so the server can end the right session',
    () async {
      final wire = _Auth();
      final api = AuthApi(baseUrl: 'http://auth.test', adapter: wire);

      await api.logout('the-token');

      expect(wire.asked.single.path, '/users/auth/logout');
      expect(wire.asked.single.headers['Authorization'], 'Bearer the-token');
    },
  );

  test(
    'a native client forgets its refresh cookie even if the server refuses',
    () async {
      final store = KeyValueStore.inMemory();
      store.set('cookies', '{"refresh_token":"still-good"}');
      final api = AuthApi(
        baseUrl: 'http://auth.test',
        cookies: StoredCookies(store),
        adapter: _Auth(),
      );

      // No token: the server says 401, exactly as it did before the fix.
      await expectLater(api.logout(''), throwsA(isA<AuthError>()));

      expect(
        store.get('cookies'),
        anyOf(isNull, '{}'),
        reason:
            'a cookie kept here would sign the person back in on the next start',
      );
    },
  );

  testWidgets('the question gets asked, and answering it signs you out', (
    tester,
  ) async {
    // The dialog is a route, and the router's gate used to treat that route as one of the addresses
    // you may be at while signed OUT. So pushing it while signed IN was read as "you are on a login
    // page" and answered with a jump to /chats: the question never appeared, and nobody was ever
    // signed out. Everything in the app that asks something went the same way.
    tester.view.physicalSize = const Size(1400, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final auth = _Agreeable();
    await tester.pumpWidget(_app(auth));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('destination-me')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('log out'));
    await tester.pumpAndSettle();

    expect(
      find.text('log out?'),
      findsOneWidget,
      reason: 'the question, over the profile — not a jump to chats',
    );

    await tester.tap(find.widgetWithText(TextButton, 'log out'));
    await tester.pumpAndSettle();

    expect(auth.asked, isTrue, reason: 'the server was told');
    expect(
      find.text('sign in'),
      findsWidgets,
      reason: 'and we are at the door',
    );
  });
}
