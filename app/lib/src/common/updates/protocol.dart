/// The updates wire, written by hand — the Dart half of what
/// backend/src/main/kotlin/app/microteams/updates/UpdatesProtocol.kt says.
///
/// Not generated, for the same reason the TypeScript half is not: this is not an OpenAPI surface,
/// and the one thing this file has to do is stay readable next to the Kotlin. Two hand-written
/// halves that can be diffed by eye beat a generator that only covers one of them.
///
/// The protocol says "topic X moved to cursor N" and never sends the thing that moved. So a frame
/// that is lost, duplicated or arrives out of order costs one redundant refetch and can never put
/// wrong data on the screen. Everything downstream is built on that being true — nothing here is
/// allowed to become the only way to learn something.
library;

import 'dart:convert';

const int updatesProtocolVersion = 1;

/// Server -> client. Anything with an unrecognised `t` must be ignored in silence.
sealed class ServerFrame {
  const ServerFrame();
}

class EventFrame extends ServerFrame {
  const EventFrame({
    required this.topic,
    required this.seq,
    this.prev,
    this.kind = '',
  });

  final String topic;
  final int seq;

  /// Where the topic stood before this event. Message ids are not contiguous, so this is the only
  /// way to notice a frame that never arrived — without it, 9134 looks the same whether or not
  /// 9120 happened. Absent on the first thing ever said about a topic.
  final int? prev;
  final String kind;
}

/// What the query's result should look like right now, asked of the data source.
class StateFrame extends ServerFrame {
  const StateFrame({
    required this.topic,
    required this.seq,
    required this.digest,
  });

  final String topic;
  final int seq;
  final String digest;
}

class AckFrame extends ServerFrame {
  const AckFrame({
    required this.granted,
    required this.refused,
    required this.cursors,
  });

  final List<String> granted;
  final List<String> refused;
  final Map<String, int> cursors;
}

class GapFrame extends ServerFrame {
  const GapFrame({required this.topic, this.seq});

  final String topic;
  final int? seq;
}

class PongFrame extends ServerFrame {
  const PongFrame();
}

class ErrFrame extends ServerFrame {
  const ErrFrame({this.message});

  final String? message;
}

/// Client -> server.
sealed class ClientFrame {
  const ClientFrame();

  Map<String, Object?> toJson();
}

class SubFrame extends ClientFrame {
  const SubFrame({required this.topics, this.since = const {}});

  final List<String> topics;
  final Map<String, int> since;

  @override
  Map<String, Object?> toJson() => {
    't': 'sub',
    'topics': topics,
    if (since.isNotEmpty) 'since': since,
  };
}

class UnsubFrame extends ClientFrame {
  const UnsubFrame({required this.topics});

  final List<String> topics;

  @override
  Map<String, Object?> toJson() => {'t': 'unsub', 'topics': topics};
}

class PingFrame extends ClientFrame {
  const PingFrame();

  @override
  Map<String, Object?> toJson() => {'t': 'ping'};
}

/// Parse a frame off the wire. Returns null for anything we do not understand — which is a normal
/// event, not an error: this client can be older than the server it is talking to (an app store
/// build someone has not updated) and newer than it too (deploy order), and both have to keep
/// working. A client that throws on an unknown frame is a client that breaks every time the
/// server learns a new word.
ServerFrame? parseFrame(String raw) {
  final Object? value;
  try {
    value = jsonDecode(raw);
  } on FormatException {
    return null;
  }
  if (value is! Map<String, Object?>) return null;

  switch (value['t']) {
    case 'event':
      final topic = value['topic'];
      final seq = value['seq'];
      if (topic is! String || seq is! num) return null;
      final prev = value['prev'];
      final kind = value['kind'];
      return EventFrame(
        topic: topic,
        seq: seq.toInt(),
        prev: prev is num ? prev.toInt() : null,
        kind: kind is String ? kind : '',
      );

    case 'state':
      final topic = value['topic'];
      final digest = value['digest'];
      if (topic is! String || digest is! String) return null;
      final seq = value['seq'];
      return StateFrame(
        topic: topic,
        seq: seq is num ? seq.toInt() : 0,
        digest: digest,
      );

    case 'ack':
      return AckFrame(
        granted: _strings(value['granted']),
        refused: _strings(value['refused']),
        cursors: _cursors(value['cursors']),
      );

    case 'gap':
      final topic = value['topic'];
      if (topic is! String) return null;
      final seq = value['seq'];
      // seq may legitimately be absent: "refetch, and tell me where you land" is a real answer
      // from a server that has just restarted and knows it knows nothing.
      return GapFrame(topic: topic, seq: seq is num ? seq.toInt() : null);

    case 'pong':
      return const PongFrame();

    case 'err':
      final message = value['message'];
      return ErrFrame(message: message is String ? message : null);

    default:
      return null;
  }
}

List<String> _strings(Object? value) {
  if (value is! List) return const [];
  return value.whereType<String>().toList(growable: false);
}

Map<String, int> _cursors(Object? value) {
  if (value is! Map) return const {};
  final out = <String, int>{};
  value.forEach((key, dynamic v) {
    if (key is String && v is num) out[key] = v.toInt();
  });
  return out;
}
