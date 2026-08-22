// A room where several people talk to one agent is shown with that agent's face.
//
// T-040, and the reason it is worth doing the way the backend offered rather than the way the React
// client did it: deciding "who here is an agent" from the app-global presence registry means the
// answer arrives AFTER the row does, so the row is painted as a grid of humans and corrected a
// moment later. Asking the server costs one query flag and the answer comes with the list, so there
// is no moment in which the row is drawn from an unknown.

import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:microteams/src/auth/auth_api.dart';
import 'package:microteams/src/chats/chats_screen.dart';
import 'package:microteams/src/common/api.dart';
import 'package:microteams/src/common/config.dart';
import 'package:microteams/src/common/ui/avatar.dart';
import 'package:microteams/src/common/ui/theme.dart';
import 'package:microteams/src/providers.dart';

class _Fake implements HttpClientAdapter {
  _Fake({required this.members});

  /// (userId, nickname, isAgent-as-JSON) for the one chat in the list.
  final String members;

  final List<String> asked = [];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    asked.add(options.uri.toString());
    const page =
        '"page":{"page_start":1,"page_size":50,"has_prev":false,"has_more":false}';
    final body = switch (options.uri.path) {
      '/mt/chat' =>
        '{"chats":[{"id":5,"title":"","updatedAt":"2026-08-21T00:00:00Z",'
            '"members":[$members]}],$page}',
      '/mt/team' => '{"teams":[{"id":1,"name":"One"}],$page}',
      _ => '{"agents":[],$page}',
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

Widget _host(_Fake backend) => ProviderScope(
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
    theme: darkTheme(),
    home: ChatsScreen(onOpen: (_) {}),
  ),
);

const _threePeopleAndAnAgent =
    '{"userId":1,"nickname":"Me","isAgent":false},'
    '{"userId":2,"nickname":"You","isAgent":false},'
    '{"userId":3,"nickname":"Them","isAgent":false},'
    '{"userId":42,"nickname":"agent3","isAgent":true}';

const _allHumans =
    '{"userId":1,"nickname":"Me","isAgent":false},'
    '{"userId":2,"nickname":"You","isAgent":false},'
    '{"userId":3,"nickname":"Them","isAgent":false}';

/// Settled twice: the list is asked for only once the session has answered, so the first settle
/// ends on the empty placeholder rather than on the list.
Future<void> settle(WidgetTester tester) async {
  await tester.pumpAndSettle();
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('the list asks the server who is an agent', (tester) async {
    final backend = _Fake(members: _allHumans);
    await tester.pumpWidget(_host(backend));
    await settle(tester);

    expect(
      backend.asked.where(
        (a) => a.contains('/mt/chat') && a.contains('queryIsMemberAgent=true'),
      ),
      isNotEmpty,
      reason: 'asked WITH the list, so the row is never drawn from an unknown',
    );
  });

  testWidgets('a room with one agent in it wears that agent\'s face', (
    tester,
  ) async {
    await tester.pumpWidget(_host(_Fake(members: _threePeopleAndAnAgent)));
    await settle(tester);

    expect(find.byType(MemberGridAvatar), findsNothing);
    final avatar = tester.widget<UserAvatar>(find.byType(UserAvatar).first);
    expect(avatar.userId, 42);
  });

  testWidgets('a room of people is still a grid of them', (tester) async {
    await tester.pumpWidget(_host(_Fake(members: _allHumans)));
    await settle(tester);

    expect(find.byType(MemberGridAvatar), findsOneWidget);
  });
}
