// Does reaching the far end of the conversation actually ask for older messages?
//
// The direct descendant of frontend/src/features/chats/useThreadMessages.test.tsx, which exists
// because this exact feature was reported broken, fixed, and reported broken again (T-073) — and
// reading the code never explained it. So this drives the real widget: a thread with more than one
// page, a scroll to the far end, and an assertion about the request that must follow.
//
// The new client's list is reversed, so "scrolled to the top" is maxScrollExtent. That is the
// whole reason the shape changed: the trigger is now the list's own end rather than a pixel
// threshold that has to be maintained.

import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:microteams/src/providers.dart';
import 'package:microteams/src/common/cache.dart';
import 'package:microteams/src/common/config.dart';
import 'package:microteams/src/chats/thread_screen.dart';
import 'package:microteams/src/common/mt_client.dart';

/// Answers listMessages from canned pages and records what was asked for.
///
/// It also answers getThread, because the screen asks who is in the conversation before it can
/// draw a name or an avatar beside a bubble. Keyed on the PATH, not on the fact that a request
/// arrived: a fake that answers every path with a message page is a fake that would let the screen
/// mis-parse a roster and still pass.
class _FakeBackend implements HttpClientAdapter {
  /// Only the message requests. The roster is fetched once and is not what these tests are about.
  final List<String> asked = [];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    if (options.uri.path.endsWith('/agent')) return _noAgents();
    if (!options.uri.path.endsWith('/messages')) return _detail();
    asked.add(options.uri.toString());

    final pageStart = options.uri.queryParameters['page_start'];
    final body = pageStart == null
        // The newest page, with more behind it — what the server returns for a long thread.
        ? _page(from: 101, to: 200, hasMore: true, nextStart: 100)
        : _page(from: 1, to: 100, hasMore: false, nextStart: null);

    return ResponseBody.fromString(
      body,
      200,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  String _page({
    required int from,
    required int to,
    required bool hasMore,
    required int? nextStart,
  }) {
    final messages = [
      for (var id = from; id <= to; id++)
        '{"id":$id,"threadId":7,"senderId":1,"content":"m$id",'
            '"createdAt":"2026-08-20T00:00:00Z"}',
    ].join(',');
    // snake_case, because that is what the contract says the Page fields are called. Getting
    // this wrong in the fake is how a test passes against a server that would have failed.
    return '{"messages":[$messages],"page":{"page_start":$to,"page_size":100,'
        '"has_prev":false,"has_more":$hasMore'
        '${nextStart == null ? '' : ',"next_start":$nextStart'}}}';
  }

  /// Nobody here is an agent. Said explicitly, because "no answer" and "no agents" are different
  /// things and only one of them is what a conversation between two humans looks like.
  ResponseBody _noAgents() => ResponseBody.fromString(
    '{"agents":[],"page":{"page_start":0,"page_size":50,'
    '"has_prev":false,"has_more":false}}',
    200,
    headers: {
      Headers.contentTypeHeader: [Headers.jsonContentType],
    },
  );

  /// One member, so a bubble has a name and an avatar to draw.
  ResponseBody _detail() => ResponseBody.fromString(
    '{"thread":{"id":7,"title":"a thread","createdAt":"2026-08-20T00:00:00Z"},'
    '"members":[{"id":1,"threadId":7,"userId":1,"role":"OWNER",'
    '"joinedAt":"2026-08-20T00:00:00Z","nickname":"probe"}]}',
    200,
    headers: {
      Headers.contentTypeHeader: [Headers.jsonContentType],
    },
  );

  @override
  void close({bool force = false}) {}
}

void main() {
  testWidgets('reaching the end of the list asks for the page before it', (
    tester,
  ) async {
    final backend = _FakeBackend();

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          // A test is not a web build, so it has to say where the server is — the same thing a
          // native build does with --dart-define. See core/config.dart.
          endpointsProvider.overrideWithValue(
            const Endpoints(origin: 'http://backend.test'),
          ),
          cacheProvider.overrideWithValue(ReadCache.inMemory()),
          mtClientProvider.overrideWithValue(
            MtClient(
              baseUrl: 'http://backend.test/mt',
              reauthorize: () async => null,
              adapter: backend,
            ),
          ),
        ],
        child: const MaterialApp(home: ThreadScreen(threadId: 7)),
      ),
    );
    await tester.pumpAndSettle();

    expect(backend.asked, hasLength(1));
    expect(find.text('m200'), findsOneWidget);

    // Scroll to the far end of the reversed list — what a reader does when they scroll up.
    final list = find.byType(ListView);
    final position = tester.state<ScrollableState>(
      find.byType(Scrollable).first,
    );
    expect(list, findsOneWidget);
    position.position.jumpTo(position.position.maxScrollExtent);
    await tester.pumpAndSettle();

    expect(
      backend.asked,
      hasLength(2),
      reason: 'scrolling to the end must ask for older messages',
    );
    expect(backend.asked.last, contains('page_start=100'));
  });

  testWidgets('does not ask again when the server said there is nothing older', (
    tester,
  ) async {
    final backend = _ShortThread();

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          // A test is not a web build, so it has to say where the server is — the same thing a
          // native build does with --dart-define. See core/config.dart.
          endpointsProvider.overrideWithValue(
            const Endpoints(origin: 'http://backend.test'),
          ),
          cacheProvider.overrideWithValue(ReadCache.inMemory()),
          mtClientProvider.overrideWithValue(
            MtClient(
              baseUrl: 'http://backend.test/mt',
              reauthorize: () async => null,
              adapter: backend,
            ),
          ),
        ],
        child: const MaterialApp(home: ThreadScreen(threadId: 7)),
      ),
    );
    await tester.pumpAndSettle();

    final position = tester.state<ScrollableState>(
      find.byType(Scrollable).first,
    );
    position.position.jumpTo(position.position.maxScrollExtent);
    await tester.pumpAndSettle();

    expect(backend.asked, hasLength(1));
    // And it says so, rather than leaving the reader unable to tell this from a broken feature.
    expect(find.text('the beginning of this conversation'), findsOneWidget);
  });
}

class _ShortThread extends _FakeBackend {
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    if (options.uri.path.endsWith('/agent')) return _noAgents();
    if (!options.uri.path.endsWith('/messages')) return _detail();
    asked.add(options.uri.toString());
    return ResponseBody.fromString(
      _page(from: 1, to: 20, hasMore: false, nextStart: null),
      200,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }
}
