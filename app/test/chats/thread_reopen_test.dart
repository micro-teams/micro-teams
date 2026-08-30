// A conversation opens again after everything it holds has been dropped.
//
// Signing in or out drops every provider holding the last account's answers (see
// userScopedProviders). Riverpod does not throw the notifier away to do that — it keeps the object
// and runs build() again. So anything build() assigns to a `late final` throws
// "Field has already been initialized" the second time, and the conversation never opens.
//
// It cost a release-only failure to find, because that is where the message showed up at all: the
// suite was green, and the browser check said only "LateInitializationError: Field ''" — the name
// stripped by minification. Nothing here invalidated this provider before, so nothing could have
// caught it.

import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:microteams/src/chats/thread_controller.dart';
import 'package:microteams/src/common/api.dart';
import 'package:microteams/src/common/config.dart';
import 'package:microteams/src/providers.dart';

class _Backend implements HttpClientAdapter {
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    // The three questions a conversation asks, answered in the shapes the contract says — a fake
    // that answers them all alike is a fake that lets a mis-parse pass.
    if (options.uri.path.endsWith('/agent')) {
      return _json(
        '{"agents":[],"page":{"page_start":0,"page_size":50,'
        '"has_prev":false,"has_more":false}}',
      );
    }
    if (!options.uri.path.endsWith('/messages')) {
      return _json(
        '{"thread":{"id":7,"title":"a thread","createdAt":"2026-08-20T00:00:00Z"},'
        '"members":[{"id":1,"threadId":7,"userId":1,"role":"OWNER",'
        '"joinedAt":"2026-08-20T00:00:00Z","nickname":"probe"}]}',
      );
    }
    return _json(
      '{"messages":[{"id":1,"threadId":7,"senderId":1,"content":"hello",'
      '"createdAt":"2026-08-20T00:00:00Z"}],'
      '"page":{"page_start":0,"page_size":1,"has_prev":false,"has_more":false,"next_start":null}}',
    );
  }

  ResponseBody _json(String body) => ResponseBody.fromString(
    body,
    200,
    headers: {
      Headers.contentTypeHeader: [Headers.jsonContentType],
    },
  );

  @override
  void close({bool force = false}) {}
}

void main() {
  test('a conversation builds again after its provider is dropped', () async {
    final container = ProviderContainer(
      overrides: [
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
    );
    addTearDown(container.dispose);

    final first = await container.read(threadProvider(7).future);
    expect(first.messages, isNotEmpty);

    // What signing in as somebody else does to it: the provider is dropped, and Riverpod runs
    // build() again on the SAME notifier.
    container.invalidate(threadProvider);

    final second = await container.read(threadProvider(7).future);
    expect(
      second.messages,
      isNotEmpty,
      reason: 'the conversation did not come back after being dropped',
    );
  });
}
