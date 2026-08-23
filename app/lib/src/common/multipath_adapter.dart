/// Dio, sending over whichever line is currently best.
///
/// An adapter rather than an interceptor, and that is the whole design. Interceptors run ABOVE
/// this: the bearer token is attached, the idempotency key is minted, the error is translated —
/// all before a line has been chosen. Underneath, the decision has already been made and travels
/// with the request. This mirrors the Go package's RoundTripper for the same reason it gives there:
/// authentication belongs closer to the caller, and line selection belongs closer to the socket.
///
/// Reads are hedged, writes are not. A read may be asked of several lines because two copies of an
/// answer are one answer; a write may not, because two writes are two writes. Only SILENCE moves a
/// request to another line — an error status is an answer, and a 404 asked of every line is still a
/// 404, asked N times.
library;

import 'dart:async';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:multipath/multipath.dart';

/// Methods that get an idempotency key and are never raced.
///
/// PUT is absent because a well-formed PUT already means the same thing twice; GET/HEAD/OPTIONS
/// because they change nothing.
const Set<String> _writes = {'POST', 'PATCH', 'DELETE'};

class MultiPathAdapter implements HttpClientAdapter {
  MultiPathAdapter({required this.manager, required HttpClientAdapter inner})
    : _inner = inner;

  final LineManager manager;
  final HttpClientAdapter _inner;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final path = _pathOf(options.uri);
    final method = options.method.toUpperCase();

    // The body is read into memory once, up front. A stream can be read once and failover needs the
    // same bytes twice; this is the same thing the Go transport does with GetBody.
    final body = requestStream == null ? null : await _collect(requestStream);

    Future<ResponseBody> attempt(Line line, {required Future<void> cancelled}) {
      // A same-origin line is left completely alone — the request goes out exactly as Dio built it.
      // Rewriting it would drop the base URL and produce a host-less path, which happens to work in
      // a browser and fails everywhere else; the adoption case must change nothing at all.
      // The query travels INSIDE the path here, so the parameters have to be cleared with it —
      // Dio appends `queryParameters` to whatever query the path already carries, and the result
      // is every parameter twice. Spring binds a repeated `path=&path=` into the single string
      // "," and answers "file not found in git: ,", which is what opening docs did the day the
      // second line started being used. Nobody saw it before that, because the same-origin branch
      // above leaves the request completely alone.
      final routed = line.url.isEmpty
          ? options
          : (options.copyWith(
              path: line.resolve(path),
              queryParameters: const <String, dynamic>{},
            )..baseUrl = '');
      return _inner.fetch(
        routed,
        body == null ? null : Stream.value(body),
        // Losing the race is what makes a request disposable; the caller's own cancellation still
        // applies to whichever attempt wins.
        cancelFuture == null
            ? cancelled
            : Future.any([cancelFuture, cancelled]),
      );
    }

    if (!_writes.contains(method)) {
      return manager.read(attempt);
    }
    return manager.write(attempt);
  }

  /// Path and query together: a line is an ORIGIN, and everything after it belongs to the request.
  String _pathOf(Uri uri) {
    final query = uri.hasQuery ? '?${uri.query}' : '';
    final path = uri.path.isEmpty ? '/' : uri.path;
    return '$path$query';
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

/// Mints one idempotency key per logical write, before any line is chosen.
///
/// Before, not per attempt: every attempt at one write carries the SAME key, which is precisely
/// what lets the server recognise a second arrival as one attempt seen twice rather than two
/// writes. A key minted per attempt would look like the mechanism was in place while defeating it.
class IdempotencyInterceptor extends Interceptor {
  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    if (_writes.contains(options.method.toUpperCase()) &&
        options.headers[idempotencyHeader] == null) {
      options.headers[idempotencyHeader] = newIdempotencyKey();
    }
    handler.next(options);
  }
}
