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

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:multipath/multipath.dart' as mp;

import 'worker_routes.dart';

/// The name every stream this product opens is addressed to.
///
/// A contract with the origin rather than a local choice: from 0.2.0-rc.1 a client names a SERVICE
/// and the origin looks it up, so a name it does not know is refused outright. That makes a typo
/// here total rather than partial, which is why it is written once and referred to.
///
/// One name for everything the app does over the wire: ordinary requests, responses that arrive
/// gradually, and WebSockets. They are all bytes on a stream to the same HTTP stack, and splitting
/// them would invent a distinction the application does not have.
const String appService = 'app';

/// Brings the substrate up in the BACKGROUND and hands out whatever is ready.
///
/// Never something a request waits on, and that is the whole shape of it. The first version awaited
/// the dial on the first request that needed one: a dial that FAILS is easy to recover from, but a
/// dial that never settles — every line unreachable, or a line that accepts a socket and then says
/// nothing — leaves every request behind it waiting forever. The app loaded to 100% and never
/// painted a frame. A transport that might never come up must not be something the product waits on.
///
/// So requests go out the ordinary way until there is a live client, and over it once there is. The
/// cost is that the first few requests of a cold start have no redundancy, which is the right trade:
/// they are the ones somebody is waiting for.
class Substrate {
  Substrate({
    required this.lines,
    mp.Client Function(List<String>)? dial,
    void Function(Object error)? onDialFailed,
  }) : _dial = dial,
       _onDialFailed = onDialFailed;

  /// Every path to the origin. Order is irrelevant — all of them carry every byte.
  List<String> lines;

  final mp.Client Function(List<String>)? _dial;
  final void Function(Object error)? _onDialFailed;
  mp.Client? _client;
  bool _dialling = false;

  /// The live client, or null while there is not one yet. Starts a dial if none is under way.
  mp.Client? clientOrStartDialling() {
    if (_client != null) return _client;
    if (_dialling || lines.isEmpty) return null;
    _dialling = true;
    unawaited(
      Future(() async {
        final dial = _dial;
        _client = dial != null
            ? dial(lines)
            : await mp.Client.dial([
                for (final line in lines) asWebSocket(line),
              ]);
      }).catchError((Object error) {
        // Said out loud, because a client that silently has no redundancy is the state this whole
        // layer exists to make impossible to be in unknowingly. Not retried here: the next line
        // registry that arrives resets this and tries again, and retrying per request would put a
        // dial attempt in front of every request the app makes.
        //
        // Only a FAILED dial is reported. "There is no transport yet" is the ordinary state of every
        // cold start and of every request that goes out before the registry has arrived — saying so
        // would put a worrying line in the log constantly, which is how a real warning later gets
        // ignored.
        (_onDialFailed ??
                (e) =>
                    debugPrint('MultiPath: no substrate, sending directly: $e'))
            .call(error);
      }),
    );
    return null;
  }

  /// The live client, or null when there is not one yet. Never starts a dial.
  ///
  /// For a caller that can carry on without the substrate and should not be the thing that brings it
  /// up — a socket, say. Requests are what dial it: they are frequent, they are short, and one of
  /// them going out the ordinary way costs nothing. A socket is long-lived, so the same wait is paid
  /// once and then held.
  mp.Client? get live => _client;

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
    _dialling = false;
  }
}

/// A line's origin as something a WebSocket can be opened at.
///
/// The registry deals in origins — `https://host` — because that is what a line IS, and every other
/// use of one wants it that way. A link is a WebSocket, and `WebSocket.connect` accepts only ws and
/// wss: handed an http URL it throws "Unsupported URL scheme 'http'" before anything reaches the
/// network. So the conversion happens here, at the one place that dials, rather than by making the
/// registry carry URLs in a shape only this caller wants.
@visibleForTesting
String asWebSocket(String origin) =>
    origin.startsWith('http') ? origin.replaceFirst('http', 'ws') : origin;

/// The request's URL, with a host on it.
///
/// On the web this app's base URL is relative — the page's own origin IS the server, and every
/// request it makes says `/mt/...` with no authority. That is right for `fetch`, which fills the
/// host in from the document, and wrong for a stream: the request written to it carries a `Host:`
/// header taken from the URL, and an empty one is answered with a 400 by any proxy worth the name.
///
/// It cost a journey to find, and the shape of it is worth remembering: every request before the
/// transport came up went out directly and worked, so the failure appeared only once the substrate
/// was carrying things — several steps after the change that caused it.
@visibleForTesting
Uri absolute(Uri url) => url.hasAuthority ? url : Uri.base.resolveUri(url);

/// Dio's adapter over the substrate.
///
/// [inner] is the ordinary HTTP adapter, and it is what a failure to dial falls back to: the origin
/// is reachable directly or this app would not be running, so a missing or misconfigured origin
/// process degrades to "no redundancy" rather than to "no product".
///
/// On the web it stands down WHEN A WORKER IS CONTROLLING THE PAGE: that worker routes every
/// request the document makes, including the API, over a substrate of its own (see web/sw.js), and
/// dialling a second one here would open a second set of links to every line to do one job.
///
/// Not simply "on the web", because a page often has no worker in front of it — the first visit
/// before one takes over, a browser with them disabled, a driven test that serves none. Standing
/// down there would mean no redundancy at all, silently, which is the state this layer exists to
/// make impossible to be in unknowingly.
class MultiPathAdapter implements HttpClientAdapter {
  MultiPathAdapter({required this.substrate, required HttpClientAdapter inner})
    : _inner = inner;

  final Substrate substrate;
  final HttpClientAdapter _inner;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    // This page's requests belong to the service worker, which is already carrying them over a
    // substrate of its own. Nothing to do here but hand the request on and let it be intercepted.
    if (aWorkerCarriesRequests) {
      return _inner.fetch(options, requestStream, cancelFuture);
    }

    // Whatever is ready right now. No lines yet, or a dial still in flight, means the ordinary way
    // — which is also the ordinary state of every app start, since the registry has not arrived and
    // the request that fetches it is one of the ones going out.
    final client = substrate.clientOrStartDialling();
    if (client == null) {
      return _inner.fetch(options, requestStream, cancelFuture);
    }

    // Read into memory once. A stream can be read once, and the request is written to the mux
    // stream in one piece; this is the same thing every other client in the org does.
    final body = requestStream == null ? null : await _collect(requestStream);

    final response = await client.roundTrip(
      appService,
      mp.MultipathRequest(
        options.method.toUpperCase(),
        absolute(options.uri),
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
