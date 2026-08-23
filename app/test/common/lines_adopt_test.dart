// The registry has to be ASKED for, and the asking has to actually happen.
//
// `adoptRegistry` existed for weeks and nothing called it: every client ran on the inline
// same-origin line no matter what the deployment's /mt/lines said, so multi-line routing was never
// once in effect. It looked fine from everywhere, because one working line is indistinguishable
// from a routing layer with nothing to route between. This is the test that would have said so.

import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:microteams/src/common/api.dart';
import 'package:microteams/src/common/config.dart';
import 'package:microteams/src/common/lines.dart';
import 'package:multipath/multipath.dart';
import 'package:microteams/src/app.dart';
import 'package:microteams/src/auth/auth_api.dart';
import 'package:microteams/src/providers.dart';

class _Fake implements HttpClientAdapter {
  _Fake({this.body = _twoLines});

  final String body;
  final List<String> asked = [];

  static const _twoLines =
      '{"lines":['
      '{"id":"origin","url":"","transport":"same-origin","weight":100},'
      '{"id":"frp-1","url":"https://frp.example","transport":"frp","weight":80}'
      ']}';

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    asked.add(options.uri.path);
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

/// Answers by path, because a whole app asks for more than one thing.
class _AppFake implements HttpClientAdapter {
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    const page =
        '"page":{"page_start":1,"page_size":100,"has_prev":false,"has_more":false}';
    final body = switch (options.uri.path) {
      '/mt/lines' => _Fake._twoLines,
      '/mt/team' => '{"teams":[{"id":1,"name":"One"}],$page}',
      '/mt/chat' => '{"chats":[],$page}',
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

class _SignedOut extends SessionController {
  @override
  Future<Session?> build() async => null;
}

ProviderContainer _container(_Fake backend) => ProviderContainer(
  overrides: [
    endpointsProvider.overrideWithValue(
      const Endpoints(origin: 'http://backend.test'),
    ),
    mtClientProvider.overrideWith(
      (ref) => MtClient(
        baseUrl: 'http://backend.test/mt',
        reauthorize: () async => null,
        lines: ref.watch(linesProvider),
        adapter: backend,
      ),
    ),
  ],
);

void main() {
  test('a client starts on the one line it already has', () {
    final container = _container(_Fake());
    addTearDown(container.dispose);

    // Before anything is asked: the origin the page came from, which always works.
    expect(container.read(linesProvider).lines.map((l) => l.id), ['origin']);
  });

  test('and adopts the registry the deployment serves', () async {
    final backend = _Fake();
    final container = _container(_Fake());
    addTearDown(container.dispose);
    final manager = container.read(linesProvider);

    await adoptRegistry(manager, container.read(mtClientProvider).transport);

    expect(manager.lines.map((l) => l.id), ['origin', 'frp-1']);
    expect(manager.lines.last.url, 'https://frp.example');
    expect(backend.asked, isEmpty, reason: 'the other fake answered');
  });

  test('an empty registry leaves the line it already had', () async {
    // A deployment that lists nothing is not a deployment with no lines; it is one that has not
    // been told about any. Dropping the origin here would take the client offline.
    final container = _container(_Fake(body: '{"lines":[]}'));
    addTearDown(container.dispose);
    final manager = container.read(linesProvider);

    await adoptRegistry(manager, container.read(mtClientProvider).transport);

    expect(manager.lines.map((l) => l.id), ['origin']);
  });

  test('a registry that cannot be read leaves the line it already had', () async {
    // Malformed rather than absent: falling back is still right, and the failure is logged rather
    // than thrown, because a client that refused to start without a routing table would make the
    // transport a startup dependency — backwards for the thing whose job is surviving an outage.
    final container = _container(_Fake(body: '{"lines":[{"id":""}]}'));
    addTearDown(container.dispose);
    final manager = container.read(linesProvider);

    await adoptRegistry(manager, container.read(mtClientProvider).transport);

    expect(manager.lines.map((l) => l.id), ['origin']);
  });

  testWidgets('the app asks for it on startup', (tester) async {
    // The bug itself: `adoptRegistry` was never called from anywhere, so the two tests above passed
    // in principle while the running app used one line forever. This is the assertion that the
    // wiring exists.
    final backend = _AppFake();
    final container = ProviderContainer(
      overrides: [
        // A manager with no way to send a probe: this test is about whether the registry is
        // ASKED for, and a live measuring loop would leave its timers running past the end of it.
        linesProvider.overrideWithValue(
          LineManager(registry: sameOriginOnly()),
        ),
        // Signed OUT on purpose: the app asks for the registry before it asks who you are — a
        // client that had to be logged in before it could route would have made the transport
        // depend on the session. It also keeps this test to one screen and one request.
        sessionProvider.overrideWith(_SignedOut.new),
        endpointsProvider.overrideWithValue(
          const Endpoints(origin: 'http://backend.test'),
        ),
        mtClientProvider.overrideWith(
          (ref) => MtClient(
            baseUrl: 'http://backend.test/mt',
            reauthorize: () async => null,
            lines: ref.watch(linesProvider),
            adapter: backend,
          ),
        ),
      ],
    );
    addTearDown(container.dispose);

    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: const MicroTeamsApp(),
      ),
    );
    await tester.pumpAndSettle();

    expect(container.read(linesProvider).lines.map((l) => l.id), [
      'origin',
      'frp-1',
    ], reason: 'asked /mt/lines and took the answer');
  });
}
