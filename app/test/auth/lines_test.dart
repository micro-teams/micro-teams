// Signing in, and staying signed in, over the same lines as everything else.
//
// Every other request in the app fails over to a working line. The session used to be the exception:
// its refresh went to the one origin, so when that origin was the unreachable one the client was
// signed out with a perfectly good line sitting beside it — the exact situation the lines exist for.
//
// In a browser this cannot be done and must not be faked: the refresh token is an httpOnly cookie
// bound to the origin that set it, and a request to another origin goes without it. So this is a
// native-client rule, and the test says so.

import 'dart:async';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:microteams/src/auth/auth_api.dart';
import 'package:microteams/src/common/multipath_adapter.dart';
import 'package:multipath/multipath.dart' as mp;

class _Wire implements HttpClientAdapter {
  final List<Uri> asked = [];

  /// Origins that answer. Anything else is silence, which is what a blocked line looks like.
  final Set<String> answering = {'http://second.test'};

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    asked.add(options.uri);
    if (!answering.contains(options.uri.origin)) {
      // Never answers, so the line looks silent rather than broken — only silence moves a request.
      return Completer<ResponseBody>().future;
    }
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
    'the identity service is asked over a line, not only over the first origin',
    () async {
      final wire = _Wire();
      final manager = mp.LineManager(
        registry: mp.parseRegistry({
          'lines': [
            {'id': 'first', 'url': 'http://first.test'},
            {'id': 'second', 'url': 'http://second.test'},
          ],
        }),
      );
      final api = AuthApi(
        baseUrl: 'http://first.test/api',
        adapter: wire,
        route: (inner) => MultiPathAdapter(manager: manager, inner: inner),
      );

      // A read, so the two lines are raced and the silent one loses. A refresh is a POST and is
      // never raced — two refreshes are two rotations of a single-use token — so what it gets from
      // the same routing is the ranking: the line that has been answering is the one it dials.
      final user = await api.me('token');

      expect(user.username, 'me');
      expect(
        wire.asked.map((uri) => uri.origin),
        contains('http://second.test'),
        reason: 'the line that answers is the one the session comes from',
      );
      expect(wire.asked.map((uri) => uri.path).toSet(), {
        '/api/users/me',
      }, reason: 'the path belongs to the request; a line is only the origin');
    },
  );
}
