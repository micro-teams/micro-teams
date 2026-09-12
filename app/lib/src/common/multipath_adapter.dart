/// Sends every request over the MultiPath substrate: one redundant stream to the origin, carried
/// over all of this deployment's lines at once.
///
/// An adapter rather than an interceptor, and that is still the whole design. Interceptors run
/// ABOVE this — the bearer token is attached, the error is translated — while the request is still
/// an ordinary HTTP request. Underneath, it stops being one: it becomes bytes on a mux stream, and
/// the redundancy happens below that, where the caller cannot see it.
///
/// What changed with 0.2.0 is that there is nothing here to decide. There used to be: reads were
/// hedged across lines, writes were pinned to one, and silence moved a request elsewhere. The
/// redundant layer does all of that per byte instead — every line carries every byte and the first
/// copy to arrive is the one delivered — so a dead line is never the one an answer comes from, with
/// no timeout to wait out and no retry to issue. This file is now only a translation: Dio's request
/// in, Dio's response out, MultiPath's shapes in between.
library;

import 'dart:async';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:multipath/multipath.dart' as mp;

/// Brings the substrate up once and hands it out, re-dialling if it has died.
///
/// Lazily, on the first request that needs it: a client whose network is not up yet must still
/// start, and an app that refused to run because it could not dial would have made the transport a
/// prerequisite for having a user interface.
class Substrate {
  Substrate({required this.lines, mp.Client Function(List<String>)? dial})
    : _dial = dial;

  /// Every path to the origin. Order is irrelevant — all of them carry every byte.
  List<String> lines;

  final mp.Client Function(List<String>)? _dial;
  mp.Client? _client;
  Future<mp.Client>? _dialling;

  /// The live client, dialling if there is not one yet.
  ///
  /// One dial at a time: without this, a screen that fires five requests at once on a cold start
  /// opens five redundant transports, each with its own links to every line, and four of them are
  /// pure waste that the origin has to hold open.
  Future<mp.Client> client() {
    final live = _client;
    if (live != null) return Future.value(live);
    return _dialling ??= _open().whenComplete(() => _dialling = null);
  }

  Future<mp.Client> _open() async {
    if (lines.isEmpty) {
      throw StateError('multipath: no line to reach the server over');
    }
    final client = _dial != null ? _dial(lines) : await mp.Client.dial(lines);
    _client = client;
    return client;
  }

  /// What the transport currently sees on each line: up, connecting or down, how many times it has
  /// recovered, and what killed it last. Empty until something has been sent, because until then
  /// there is no transport to ask.
  ///
  /// Redundancy hides line failure from the data path on purpose — this is the one place a caller
  /// can see the failures it is surviving.
  List<mp.LinkStat> stats() => _client?.stats() ?? const [];

  /// The URL of line [index], for a view that has a stat and wants to name the path it belongs to.
  String urlOf(int index) =>
      index >= 0 && index < lines.length ? lines[index] : '';

  /// Drops the transport, so the next request dials afresh. Used when the registry changes: a
  /// redundant stream's links are fixed when it is dialled, so a new list means a new dial.
  void reset() {
    _client?.close();
    _client = null;
  }
}

/// Dio's adapter over the substrate.
///
/// [inner] is the ordinary HTTP adapter, and it is the answer in two cases rather than one. On the
/// web it is the ONLY answer: a page's requests are routed by the service worker, which holds the
/// substrate for the whole document, and a second one dialled from inside the Dart isolate would be
/// a duplicate transport doing the same job twice. And on any platform it is what a failure to dial
/// falls back to — the origin is reachable directly or the app would not have loaded, so a
/// misconfigured or absent origin process degrades to "no redundancy" rather than to "no product".
class MultiPathAdapter implements HttpClientAdapter {
  MultiPathAdapter({
    required this.substrate,
    required HttpClientAdapter inner,
    void Function(Object error)? onFallback,
  }) : _inner = inner,
       _onFallback = onFallback;

  final Substrate substrate;
  final HttpClientAdapter _inner;
  final void Function(Object error)? _onFallback;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    // No lines yet is not a failure and must not be reported as one. It is the ordinary state of
    // every app start — the registry has not arrived, and the request that fetches it is one of the
    // ones going out right now. Reporting it would put a worrying line in the log on every cold
    // start, which is how a real warning later gets ignored.
    if (substrate.lines.isEmpty) {
      return _inner.fetch(options, requestStream, cancelFuture);
    }

    final mp.Client client;
    try {
      client = await substrate.client();
    } catch (error) {
      _onFallback?.call(error);
      return _inner.fetch(options, requestStream, cancelFuture);
    }

    // Read into memory once. A stream can be read once, and the request is written to the mux
    // stream in one piece; this is the same thing every other client in the org does.
    final body = requestStream == null ? null : await _collect(requestStream);

    final response = await client.roundTrip(
      mp.MultipathRequest(
        options.method.toUpperCase(),
        options.uri,
        headers: {
          for (final entry in options.headers.entries)
            entry.key: '${entry.value}',
        },
        body: body,
      ),
    );

    return ResponseBody.fromBytes(
      response.body,
      response.statusCode,
      headers: {
        for (final entry in response.headers.entries) entry.key: [entry.value],
      },
      statusMessage: response.reasonPhrase,
    );
  }

  Future<Uint8List> _collect(Stream<Uint8List> stream) async {
    final chunks = <int>[];
    await for (final chunk in stream) {
      chunks.addAll(chunk);
    }
    return Uint8List.fromList(chunks);
  }

  @override
  void close({bool force = false}) => _inner.close(force: force);
}
