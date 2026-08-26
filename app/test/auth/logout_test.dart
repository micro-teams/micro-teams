// Signing out has to reach the server, and the server has to know who is signing out.
//
// The endpoint is authenticated: called without the access token it answers 401, the refresh cookie
// lives on, and the next boot refreshes straight back into the session that was just ended. Locally
// it looks like a logout; one reload later it is undone. That is the bug this file watches for.

import 'dart:typed_data';

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
}
