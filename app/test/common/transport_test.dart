// The transport, which is now MultiPath's rather than ours.
//
// These are the properties the change was made for, and none of them is visible from a screen: a
// read that is hedged across lines, a write that is not, one idempotency key carried across every
// attempt at one write, and an error STATUS treated as an answer rather than as a reason to ask
// somebody else. Without assertions the whole thing looks identical to what it replaced — which is
// exactly the failure mode this layer has.

import 'dart:async';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:microteams/src/common/api.dart';
import 'package:microteams/src/common/errors.dart';
import 'package:mt_api/mt_api.dart';
import 'package:multipath/multipath.dart' as mp;

/// Records every attempt that reached the wire, and can be told how each line behaves.
class _Wire implements HttpClientAdapter {
  _Wire({this.slow = const {}, this.dead = const {}, this.status = 200});

  /// Origins that answer only after a delay — long enough to lose a hedge.
  final Set<String> slow;

  /// Origins that never answer at all.
  final Set<String> dead;

  final int status;

  final List<String> urls = [];
  final List<String?> keys = [];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    urls.add(options.uri.toString());
    keys.add(options.headers[mp.idempotencyHeader] as String?);

    final host = options.uri.host;
    if (dead.contains(host)) {
      await Future<void>.delayed(const Duration(seconds: 30));
    }
    if (slow.contains(host)) {
      await Future<void>.delayed(const Duration(milliseconds: 300));
    }
    return ResponseBody.fromString(
      '{"ok":true}',
      status,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

mp.Registry _two() => mp.parseRegistry({
  'lines': [
    {'id': 'a', 'url': 'https://a.test'},
    {'id': 'b', 'url': 'https://b.test'},
  ],
});

/// Absolute because Dio refuses a relative base off the web. On the web the app's base IS relative
/// (`/mt`), which is the case the same-origin assertion below stands in for.
const String _base = 'http://origin.test/mt';

MtClient _client(_Wire wire, {mp.Registry? registry}) => MtClient(
  baseUrl: _base,
  reauthorize: () async => null,
  lines: mp.LineManager(registry: registry ?? _two()),
  adapter: wire,
);

void main() {
  test('a request routed to another line keeps its query exactly once', () async {
    // Dio appends queryParameters to whatever query the path already has. The path handed to a
    // line carries the query with it — a line is an origin, everything after it belongs to the
    // request — so leaving the parameters on duplicates every one of them. Spring binds a repeated
    // `path=&path=` into the single string "," and answers "file not found in git: ,", which is
    // exactly what opening docs did once a second line was actually in use.
    final wire = _Wire(dead: {'a.test'});
    final client = _client(wire);
    // The fake wire answers with a body that is not a DocNode; what is under test is the URL
    // that left, not what came back.
    try {
      await client.team.getDocument(id: 1, recursive: true);
    } catch (_) {}

    final routed = wire.urls.firstWhere((u) => u.startsWith('https://b.test'));
    final query = Uri.parse(routed).queryParametersAll;
    expect(query['path'], hasLength(1), reason: routed);
    expect(query['recursive'], hasLength(1), reason: routed);
  });
  test('a single same-origin line sends exactly what it always sent', () async {
    // The adoption case, and the reason this could be turned on at all: with one same-origin line
    // the request that leaves is byte for byte the one that left before MultiPath existed.
    final wire = _Wire();
    final client = _client(
      wire,
      registry: mp.parseRegistry({
        'lines': [
          {'id': 'origin', 'url': ''},
        ],
      }),
    );
    await client.transport.probe();
    expect(wire.urls.single, '$_base/probe');
  });

  test('a read is hedged: a slow line does not hold it up', () async {
    final wire = _Wire(slow: {'a.test'});
    await _client(wire).transport.probe();
    expect(
      wire.urls.length,
      2,
      reason: 'the second line was asked once the first went quiet',
    );
    expect(wire.urls.any((u) => u.startsWith('https://b.test')), isTrue);
  });

  test('a healthy read asks exactly one line', () async {
    // What makes hedging affordable. Always fanning out would multiply every request by the number
    // of lines to buy an improvement that only exists on the slow tail.
    final wire = _Wire();
    await _client(wire).transport.probe();
    expect(wire.urls, hasLength(1));
  });

  test('a write is never raced, and every attempt carries the same key', () async {
    // Two writes are two writes. Failover is safe only because the server can recognise the second
    // arrival as one attempt seen twice — which it can only do if the key does not change.
    final wire = _Wire(dead: {'a.test'});
    final client = _client(wire);
    unawaited(
      client.team.createTeam(
        createTeamRequest: CreateTeamRequest(name: 'a team'),
      ),
    );
    await Future<void>.delayed(const Duration(milliseconds: 200));

    expect(
      wire.urls,
      hasLength(1),
      reason: 'writes are sent one line at a time',
    );
    expect(wire.keys.single, isNotNull);
  });

  test(
    'an error status is an answer, not a reason to ask another line',
    () async {
      // A 404 hedged across every line is still a 404, asked N times. Only silence leaves it unknown
      // whether anything happened.
      final wire = _Wire(status: 404);
      final client = _client(wire);
      await expectLater(
        client.transport.probe(),
        throwsA(isA<MtError>().having((e) => e.status, 'status', 404)),
      );
      expect(wire.urls, hasLength(1));
    },
  );

  test('a successful GET is remembered under the request itself', () async {
    final wire = _Wire();
    final client = _client(wire);
    expect(client.cached<Object?>('GET', '/mt/probe'), isNull);
    await client.transport.probe();
    expect(client.cached<Map<String, Object?>>('GET', '/mt/probe'), {
      'ok': true,
    });
  });
}
