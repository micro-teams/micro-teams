/// The native half of [socketOverSubstrate]. See substrate_socket.dart.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

import 'package:multipath/multipath.dart' as mp;
import 'package:web_socket_channel/io.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import 'multipath_adapter.dart';

/// Opens [url] as a WebSocket carried on a mux stream, or returns null when there is no transport
/// to carry it.
///
/// Null rather than an error, and the caller dials the ordinary way instead: a socket that refused
/// to open because the substrate was not up yet would make the live terminal depend on a transport
/// that is allowed to be absent.
///
/// It uses a transport that is already up and never starts one. Requests are what bring it up —
/// they are frequent and short, and one going out directly costs nothing — whereas a socket is held
/// for hours, so a dial started here would be a wait at the worst moment and, on a deployment with
/// no origin, a retry loop nobody asked for.
WebSocketChannel? socketOverSubstrate(Substrate substrate, Uri url) {
  final client = substrate.live;
  if (client == null) return null;
  return IOWebSocketChannel(_upgrade(client, url));
}

/// Writes the upgrade request, reads the response, and hands the rest of the stream to dart:io.
Future<WebSocket> _upgrade(mp.Client client, Uri url) async {
  final stream = client.open(appService);

  // The key is the client's half of the handshake: the server answers with it hashed, which is what
  // proves the thing that replied is a WebSocket server rather than a cache or a proxy that happens
  // to return 101. dart:io checks nothing here — this connection is handed to it already upgraded —
  // so the check is ours to make.
  final key = base64.encode(
    Uint8List.fromList(
      List<int>.generate(16, (_) => Random.secure().nextInt(256)),
    ),
  );
  final path = url.path.isEmpty ? '/' : url.path;
  final target = url.hasQuery ? '$path?${url.query}' : path;
  final request =
      'GET $target HTTP/1.1\r\n'
      'Host: ${url.authority}\r\n'
      'Upgrade: websocket\r\n'
      'Connection: Upgrade\r\n'
      'Sec-WebSocket-Key: $key\r\n'
      'Sec-WebSocket-Version: 13\r\n'
      '\r\n';
  await stream.write(Uint8List.fromList(utf8.encode(request)));

  // Read until the end of the headers, keeping whatever came after them: the server may send its
  // first frames in the same packet as the 101, and those bytes belong to the WebSocket.
  final buffer = BytesBuilder(copy: false);
  var headerEnd = -1;
  while (headerEnd < 0) {
    final chunk = await stream.read();
    if (chunk == null) {
      throw WebSocketChannelException(
        'the origin closed before answering the upgrade',
      );
    }
    buffer.add(chunk);
    headerEnd = _endOfHeaders(buffer.toBytes());
  }
  final all = buffer.toBytes();
  final head = utf8.decode(all.sublist(0, headerEnd), allowMalformed: true);
  final rest = all.sublist(headerEnd);

  final status = head.split('\r\n').first;
  if (!status.contains(' 101')) {
    throw WebSocketChannelException('the upgrade was refused: $status');
  }
  if (!_accepts(head, key)) {
    throw WebSocketChannelException(
      'the upgrade was answered without a matching Sec-WebSocket-Accept',
    );
  }

  return WebSocket.fromUpgradedSocket(
    _StreamSocket(stream, rest),
    serverSide: false,
  );
}

int _endOfHeaders(Uint8List bytes) {
  for (var i = 3; i < bytes.length; i++) {
    if (bytes[i] == 10 &&
        bytes[i - 1] == 13 &&
        bytes[i - 2] == 10 &&
        bytes[i - 3] == 13) {
      return i + 1;
    }
  }
  return -1;
}

/// The server's proof that it really is a WebSocket server: the key, salted with the protocol's own
/// constant and hashed. Checked rather than assumed — a 101 from something else is a 101 all the
/// same.
bool _accepts(String head, String key) {
  final expected = base64.encode(
    sha1OfString(
      '$key'
      '258EAFA5-E914-47DA-95CA-C5AB0DC85B11',
    ),
  );
  for (final line in head.split('\r\n')) {
    final at = line.indexOf(':');
    if (at < 0) continue;
    if (line.substring(0, at).toLowerCase() != 'sec-websocket-accept') continue;
    return line.substring(at + 1).trim() == expected;
  }
  return false;
}

/// A mux stream dressed as the [Socket] `dart:io` expects to be handed after an upgrade.
///
/// Most of [Socket] is about being a TCP endpoint — addresses, ports, socket options — and none of
/// it is answerable here, because this is not one. What the WebSocket implementation uses is the
/// byte stream and the sink, and those are real.
class _StreamSocket extends Stream<Uint8List> implements Socket {
  _StreamSocket(this._stream, Uint8List leftover) {
    // Whatever arrived in the same read as the 101 belongs to the WebSocket, not to the handshake.
    if (leftover.isNotEmpty) _incoming.add(leftover);
    unawaited(_pump());
  }

  final mp.MuxStream _stream;
  final StreamController<Uint8List> _incoming = StreamController<Uint8List>();
  var _closed = false;

  Future<void> _pump() async {
    try {
      while (!_closed) {
        final chunk = await _stream.read();
        if (chunk == null) break;
        _incoming.add(chunk);
      }
    } catch (error, stack) {
      _incoming.addError(error, stack);
    } finally {
      await _incoming.close();
    }
  }

  @override
  StreamSubscription<Uint8List> listen(
    void Function(Uint8List event)? onData, {
    Function? onError,
    void Function()? onDone,
    bool? cancelOnError,
  }) => _incoming.stream.listen(
    onData,
    onError: onError,
    onDone: onDone,
    cancelOnError: cancelOnError,
  );

  @override
  void add(List<int> data) {
    unawaited(_stream.write(Uint8List.fromList(data)));
  }

  @override
  void write(Object? object) => add(utf8.encode('$object'));

  @override
  void writeAll(Iterable<dynamic> objects, [String separator = '']) =>
      write(objects.join(separator));

  @override
  void writeln([Object? object = '']) => write('$object\n');

  @override
  void writeCharCode(int charCode) => write(String.fromCharCode(charCode));

  @override
  void addError(Object error, [StackTrace? stackTrace]) =>
      _incoming.addError(error, stackTrace);

  @override
  Future<void> addStream(Stream<List<int>> stream) async {
    await for (final chunk in stream) {
      add(chunk);
    }
  }

  @override
  Future<void> get done => _incoming.done;

  @override
  Future<void> flush() async {}

  @override
  Future<void> close() async {
    _closed = true;
    _stream.closeWrite();
    await _incoming.done;
  }

  @override
  void destroy() {
    _closed = true;
    _stream.reset();
  }

  @override
  Encoding get encoding => utf8;

  @override
  set encoding(Encoding value) =>
      throw UnsupportedError('a mux stream carries bytes, not text');

  // The TCP surface. Nothing below is a question this can answer: there is no socket underneath,
  // only a stream that several lines are carrying at once. Answered where an answer is harmless and
  // refused where a wrong answer would be worse than none.
  @override
  InternetAddress get address => InternetAddress.anyIPv4;

  @override
  InternetAddress get remoteAddress => InternetAddress.anyIPv4;

  @override
  int get port => 0;

  @override
  int get remotePort => 0;

  @override
  bool setOption(SocketOption option, bool enabled) => false;

  @override
  Uint8List getRawOption(RawSocketOption option) =>
      throw UnsupportedError('no socket options on a mux stream');

  @override
  void setRawOption(RawSocketOption option) =>
      throw UnsupportedError('no socket options on a mux stream');
}

/// SHA-1 of a string, as the WebSocket handshake defines it.
///
/// Written out rather than taken from `package:crypto`, which this app does not otherwise need: one
/// hash, of one fixed shape, is a smaller thing to own than a dependency — and this one is pinned by
/// the protocol, so it can never need to change.
Uint8List sha1OfString(String input) {
  final message = utf8.encode(input);
  final bitLength = message.length * 8;
  final padded = BytesBuilder()
    ..add(message)
    ..addByte(0x80);
  while ((padded.length + 8) % 64 != 0) {
    padded.addByte(0);
  }
  final tail = ByteData(8)..setUint64(0, bitLength);
  padded.add(tail.buffer.asUint8List());
  final blocks = padded.toBytes();

  var h0 = 0x67452301,
      h1 = 0xEFCDAB89,
      h2 = 0x98BADCFE,
      h3 = 0x10325476,
      h4 = 0xC3D2E1F0;
  final w = List<int>.filled(80, 0);
  for (var start = 0; start < blocks.length; start += 64) {
    final view = ByteData.sublistView(blocks, start, start + 64);
    for (var i = 0; i < 16; i++) {
      w[i] = view.getUint32(i * 4);
    }
    for (var i = 16; i < 80; i++) {
      w[i] = _rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    }
    var a = h0, b = h1, c = h2, d = h3, e = h4;
    for (var i = 0; i < 80; i++) {
      final int f, k;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5A827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ED9EBA1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8F1BBCDC;
      } else {
        f = b ^ c ^ d;
        k = 0xCA62C1D6;
      }
      final temp = (_rotl(a, 5) + f + e + k + w[i]) & 0xFFFFFFFF;
      e = d;
      d = c;
      c = _rotl(b, 30);
      b = a;
      a = temp;
    }
    h0 = (h0 + a) & 0xFFFFFFFF;
    h1 = (h1 + b) & 0xFFFFFFFF;
    h2 = (h2 + c) & 0xFFFFFFFF;
    h3 = (h3 + d) & 0xFFFFFFFF;
    h4 = (h4 + e) & 0xFFFFFFFF;
  }
  final out = ByteData(20)
    ..setUint32(0, h0)
    ..setUint32(4, h1)
    ..setUint32(8, h2)
    ..setUint32(12, h3)
    ..setUint32(16, h4);
  return out.buffer.asUint8List();
}

int _rotl(int value, int by) =>
    ((value << by) | ((value & 0xFFFFFFFF) >> (32 - by))) & 0xFFFFFFFF;
