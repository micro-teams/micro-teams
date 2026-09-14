// Approving a new machine, in the two states a journey cannot reach.
//
// The happy path — pick a team, approve, the code and the teams go up — is the machine journey's
// now (integration_test/machine_journey_test.dart), where a real host really does come online
// afterwards. What is left here are the two refusals: no team picked, and a link with no code in
// it. Both are about NOT sending a request, and the only way to be sure nothing was sent is to
// hold the wire, which is what this fake does.

import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:microteams/src/agents/connect_screen.dart';
import 'package:microteams/src/auth/auth_api.dart';
import 'package:microteams/src/common/api.dart';
import 'package:microteams/src/common/config.dart';
import 'package:microteams/src/providers.dart';

class _Fake implements HttpClientAdapter {
  final List<({String call, Object? body})> wrote = [];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final call = '${options.method} ${options.uri.path}';
    if (options.method != 'GET') wrote.add((call: call, body: options.data));

    const page =
        '"page":{"page_start":1,"page_size":100,"has_prev":false,"has_more":false}';
    final body = switch (call) {
      'GET /mt/team' =>
        '{"teams":[{"id":1,"name":"One"},{"id":2,"name":"Two"}],$page}',
      'POST /mt/machine/enroll/approve' =>
        '{"id":"m9","name":"new-box","online":true,"teamIds":[2]}',
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

Widget _host(_Fake backend, {String code = 'abc123'}) => ProviderScope(
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
    home: ConnectScreen(code: code, onDone: () {}),
  ),
);

/// Settled twice: the teams list arrives a round after the session does, and a single settle ends
/// with the page still empty — which is a test that fails for a reason that has nothing to do with
/// what it is asking about.
Future<void> settle(WidgetTester tester) async {
  await tester.pumpAndSettle();
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('a machine with no team to serve is not approved', (
    tester,
  ) async {
    // The server would refuse it, and a client that lets you press the button anyway makes you
    // wait for a round trip to be told what it already knew.
    final backend = _Fake();
    await tester.pumpWidget(_host(backend));
    await settle(tester);

    await tester.tap(find.text('approve this machine'));
    await tester.pumpAndSettle();

    expect(backend.wrote, isEmpty);
    expect(find.textContaining('pick at least one team'), findsOneWidget);
  });

  testWidgets('a link with no code says so instead of failing later', (
    tester,
  ) async {
    final backend = _Fake();
    await tester.pumpWidget(_host(backend, code: ''));
    await settle(tester);

    expect(find.textContaining('this link has no code'), findsOneWidget);

    await tester.tap(find.text('One'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('approve this machine'));
    await tester.pumpAndSettle();

    expect(backend.wrote, isEmpty);
  });
}
