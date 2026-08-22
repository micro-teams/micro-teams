// The cache is keyed by the REQUEST, so a caller that wants the last answer has to name the
// question. These tests are the reason that is safe.
//
// Each one makes the real call through the generated client against a fake wire, then reads the
// cache back with the path constant the controller uses. If openapi-generator changes how it builds
// a query, or somebody edits the page size in one place and not the other, this fails here instead
// of silently turning a warm start back into a spinner — which nobody would ever notice, because a
// cache that never hits looks exactly like a cache that is not needed.

import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:microteams/src/chats/chats_controller.dart';
import 'package:microteams/src/chats/thread_controller.dart';
import 'package:microteams/src/common/api.dart';
import 'package:microteams/src/common/team_scope.dart';

class _Wire implements HttpClientAdapter {
  final List<String> paths = [];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    paths.add(
      '${options.uri.path}${options.uri.hasQuery ? '?${options.uri.query}' : ''}',
    );
    return ResponseBody.fromString(
      '{"chats":[],"teams":[],"messages":[],'
      '"page":{"page_start":0,"page_size":1,"has_prev":false,"has_more":false}}',
      200,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

MtClient _client(_Wire wire) => MtClient(
  baseUrl: 'http://origin.test/mt',
  reauthorize: () async => null,
  adapter: wire,
);

void main() {
  test('the chat list is cached under the path its controller reads', () async {
    final wire = _Wire();
    final client = _client(wire);
    await client.chat.listChats(
      pageSize: chatsPageSize,
      queryIsMemberAgent: true,
    );
    // Note the second parameter: the generated client sends `queryIsMemberAgent` whether or
    // not the caller mentions it, and a constant that omitted it would key the cache under a
    // request that is never made. That is precisely what this test caught.
    expect(wire.paths.single, chatsPath.substring(0));
    expect(
      client.cached<Map<String, Object?>>('GET', chatsPath),
      isNotNull,
      reason: 'chats_controller seeds from exactly this key',
    );
  });

  test('a thread\'s newest page is cached under newestPagePath', () async {
    final wire = _Wire();
    final client = _client(wire);
    await client.chat.listMessages(id: 7, pageSize: pageSize);
    expect(wire.paths.single, newestPagePath(7));
    expect(
      client.cached<Map<String, Object?>>('GET', newestPagePath(7)),
      isNotNull,
      reason: 'thread_controller seeds a cold conversation from this key',
    );
  });

  test('the team list is cached under teamsPath', () async {
    final wire = _Wire();
    final client = _client(wire);
    await client.team.listTeams(pageSize: 100);
    expect(
      client.cached<Map<String, Object?>>('GET', teamsPath),
      isNotNull,
      reason: 'team_scope seeds from this key',
    );
  });

  test('one account never reads another account\'s answers', () async {
    final client = _client(_Wire());
    client.cache.setScope('1');
    await client.chat.listChats(
      pageSize: chatsPageSize,
      queryIsMemberAgent: true,
    );
    expect(client.cached<Object?>('GET', chatsPath), isNotNull);

    client.cache.setScope('2');
    expect(
      client.cached<Object?>('GET', chatsPath),
      isNull,
      reason: 'a different user is a different cache, not a shared one',
    );
  });
}
