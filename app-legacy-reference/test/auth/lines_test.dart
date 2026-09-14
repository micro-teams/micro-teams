// Signing in, and staying signed in, over the same transport as everything else.
//
// Every other request in the app goes over the substrate. The session used to be the exception: its
// refresh went to the one origin, so when that origin was the unreachable one the client was signed
// out with a perfectly good line sitting beside it — the exact situation the lines exist for.
//
// In a browser this cannot be done and must not be faked: the refresh token is an httpOnly cookie
// bound to the origin that set it, and a request to another origin goes without it. So this is a
// native-client rule, and the test says so.
//
// What is asserted is that the auth client's requests go through the transport at all — proved by
// making the dial fail and catching the fallback, which only something routed through the substrate
// adapter can produce. Which line answers first is no longer anybody's business: the redundant layer
// writes every byte to every line and takes the copy that arrives first.

import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:microteams/src/auth/auth_api.dart';
import 'package:microteams/src/common/multipath_adapter.dart';

class _Wire implements HttpClientAdapter {
  final List<Uri> asked = [];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    asked.add(options.uri);
    return ResponseBody.fromString(
      '{"code":200,"data":{"user":{"id":1,"username":"me","nickname":"Me",'
      '"avatarId":0,"intro":""},"accessToken":"fresh"}}',
      200,
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
    'the identity service is asked over the transport, not beside it',
    () async {
      final wire = _Wire();
      var fellBack = 0;
      final api = AuthApi(
        baseUrl: 'http://first.test/api',
        adapter: wire,
        route: (inner) => MultiPathAdapter(
          substrate: Substrate(
            lines: const ['http://first.test'],
            dial: (_) => throw StateError('no route'),
            onDialFailed: (_) => fellBack++,
          ),
          inner: inner,
        ),
      );

      final user = await api.me('token');
      // The dial happens beside the request rather than in front of it, so its report arrives on a
      // later turn of the event loop.
      await Future<void>.delayed(Duration.zero);

      expect(user.username, 'me');
      expect(
        fellBack,
        1,
        reason: 'the session request never reached the transport at all',
      );
      expect(wire.asked.map((uri) => uri.path).toSet(), {
        '/api/users/me',
      }, reason: 'the path belongs to the request; a line is only the origin');
    },
  );
}
