// The one piece of protocol this app owns, checked against the protocol's own numbers.
//
// The WebSocket handshake proves the far end is a WebSocket server by hashing the key the client
// sent. Getting that wrong is not a subtle failure — every socket would be refused — but getting it
// SILENTLY wrong is possible in the other direction: a check that always passes would accept a 101
// from something that is not a WebSocket server at all, which is exactly what a proxy in the middle
// might produce.
//
// So the hash is checked against published vectors rather than against itself.
@TestOn('vm')
library;

import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:microteams/src/common/substrate_socket_io.dart';

String hex(List<int> bytes) =>
    bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();

void main() {
  test('SHA-1 matches the published vectors', () {
    expect(hex(sha1OfString('')), 'da39a3ee5e6b4b0d3255bfef95601890afd80709');
    expect(
      hex(sha1OfString('abc')),
      'a9993e364706816aba3e25717850c26c9cd0d89d',
    );
    expect(
      hex(
        sha1OfString(
          'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
        ),
      ),
      '84983e441c3bd26ebaae4aa1f95129e5e54670f1',
    );
  });

  test('and the handshake example from RFC 6455 itself', () {
    // Section 1.3: the key "dGhlIHNhbXBsZSBub25jZQ==" must be answered with this accept value. If
    // this passes, a server built to the RFC and this client agree — which is the only thing that
    // matters, and is not something a test of our own devising could establish.
    final accept = base64.encode(
      sha1OfString(
        'dGhlIHNhbXBsZSBub25jZQ==258EAFA5-E914-47DA-95CA-C5AB0DC85B11',
      ),
    );
    expect(accept, 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
  });
}
