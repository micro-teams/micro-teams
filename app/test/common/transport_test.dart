// The transport, which is MultiPath's — and after 0.2.0 has almost nothing left to decide.
//
// This file used to pin four decisions made here: a read hedged across lines, a write pinned to one,
// one idempotency key carried across every attempt at a write, and an error STATUS treated as an
// answer rather than as a reason to ask somebody else. All four are gone, and not because they
// stopped mattering — because the substrate does the same work per byte instead of per request. It
// writes every byte to every line and delivers whichever copy arrives first, so a slow line is
// already never the one an answer comes from, a dead one costs no timeout, and there is no second
// attempt for a key to be carried across.
//
// What is left here is what this repository still decides, and both are the kind of thing that fails
// silently: that a client with no lines yet sends its request the ordinary way rather than failing
// (the app has to work before it knows where the lines are — the request that ASKS is one of them),
// and that a successful read is remembered under the request itself.
//
// The proof that requests really travel over the substrate is not here and cannot honestly be: with
// a stub on one end and a stub on the other, a test proves the wiring compiles. It belongs in the
// journey, against a deployment with a real origin process in front of it.

import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:microteams/src/common/api.dart';
import 'package:microteams/src/common/errors.dart';
import 'package:microteams/src/common/multipath_adapter.dart';

/// Records every request that reached the wire.
class _Wire implements HttpClientAdapter {
  _Wire({this.status = 200});

  final int status;
  final List<String> urls = [];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    urls.add(options.uri.toString());
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

/// Absolute because Dio refuses a relative base off the web. On the web the app's base IS relative
/// (`/mt`), which is the case the same-origin assertion below stands in for.
const String _base = 'http://origin.test/mt';

MtClient _client(_Wire wire, {Substrate? substrate}) => MtClient(
  baseUrl: _base,
  reauthorize: () async => null,
  substrate: substrate ?? Substrate(lines: const []),
  adapter: wire,
);

void main() {
  test('with no line yet, a request goes out exactly as it always did', () async {
    // The adoption case, and the case every app start passes through: the registry has not arrived,
    // so there is nothing to carry a stream over, and the request that leaves is byte for byte the
    // one that left before MultiPath existed. It is also the request that FETCHES the registry —
    // which can never go over the lines it is about, so this path can never be removed.
    final wire = _Wire();
    await _client(wire).transport.probe();
    expect(wire.urls.single, '$_base/probe');
  });

  test('a transport that cannot be dialled falls back rather than failing', () async {
    // A line that cannot be reached must not take the product with it — and must not make it WAIT
    // either, which is the sharper half. A dial that fails is easy; a dial that never settles is
    // what left the web app at 100% with no first frame. So the request goes out immediately and the
    // dial happens beside it.
    //
    // The origin is reachable directly or this app would not be running at all, so a missing or
    // misconfigured origin process degrades to "no redundancy" — which is where every deployment was
    // last month — instead of to a client that cannot talk to its server.
    final wire = _Wire();
    final failures = <Object>[];
    final client = MtClient(
      baseUrl: _base,
      reauthorize: () async => null,
      // A URL nothing answers at: dialling it is the failure this is about.
      substrate: Substrate(
        lines: const ['http://127.0.0.1:1'],
        dial: (_) => throw StateError('no route'),
        onDialFailed: failures.add,
      ),
      adapter: wire,
    );

    await client.transport.probe();
    // The dial happens beside the request rather than in front of it, so the report arrives on a
    // later turn of the event loop. That ordering IS the fix: a request must never wait on a dial.
    await Future<void>.delayed(Duration.zero);

    expect(wire.urls.single, '$_base/probe');
    expect(
      failures,
      hasLength(1),
      reason: 'falling back has to be visible, not silent',
    );
  });

  test('an error status is an answer', () async {
    final wire = _Wire(status: 404);
    await expectLater(
      _client(wire).transport.probe(),
      throwsA(isA<MtError>().having((e) => e.status, 'status', 404)),
    );
    expect(wire.urls, hasLength(1));
  });

  test('a relative request is given a host before it is written to a stream', () {
    // The web's base URL is relative: the page's own origin IS the server, so every request says
    // "/mt/..." with no authority. `fetch` fills that in from the document; a stream cannot — the
    // request written to it carries a Host header taken from the URL, and an empty one is answered
    // with a 400.
    //
    // The journey is what caught this, and the reason it took until then is worth keeping: every
    // request made before the transport came up went out directly and worked, so nothing looked
    // wrong until the substrate was actually carrying something.
    expect(absolute(Uri.parse('/mt/chat/1/messages')).hasAuthority, isTrue);
    expect(
      absolute(Uri.parse('https://elsewhere.example/mt/probe')).toString(),
      'https://elsewhere.example/mt/probe',
      reason: 'a URL that already names a host must be left exactly as it is',
    );
  });

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
