/// Who is subscribed to what, what the server has said about it, and — the part that earns this
/// file's keep — whether what we hold still agrees with what the server says it should be.
///
/// No Flutter, no WebSocket: both are wired in from outside, which is what makes the awkward cases
/// (a hole in the stream, a reconnect, a server that restarted, a digest that disagrees) testable
/// without a device.
///
/// What this deliberately does NOT hold is data. It holds cursors, digests and callbacks, and
/// tells a feature "go and look". Keeping the data out is what keeps exactly one path to the
/// screen, which is the whole reason a lost or duplicated frame here can never show a wrong
/// message.
library;

import 'package:flutter/foundation.dart';

import 'protocol.dart';

enum SyncReason {
  /// An ordinary event: the topic moved.
  event,

  /// A frame never arrived — the event chain does not line up with our cursor.
  hole,

  /// The server cannot catch us up (it restarted, or we were away too long).
  gap,

  /// The socket came back; we cannot know what happened while it was down.
  reconnect,

  /// What we hold disagrees with what the server says it should be. This one is a bug report.
  mismatch,
}

/// A subscriber may supply [digest], a function over the data it already holds. That is the one
/// thing a feature must provide beyond "refetch me", and it has to: only the feature knows what it
/// is holding. Without it the periodic check still arrives — it just cannot be compared, so a
/// topic with no digest falls back to trusting the event stream.
class TopicListener {
  TopicListener({required this.onChange, this.digest});

  final void Function(SyncReason reason) onChange;
  final String? Function()? digest;
}

abstract class UpdatesTransport {
  /// Send a frame. May be dropped while disconnected — resubscription is the store's job.
  void send(ClientFrame frame);
}

class UpdatesStore {
  final Map<String, Set<TopicListener>> _listeners = {};
  final Map<String, int> _cursors = {};
  UpdatesTransport? _transport;

  /// Topics refused by the server. Kept so a refusal is visible rather than looking like silence.
  final Set<String> refused = {};

  /// How many times a periodic check found us out of date. Zero on a healthy system: an event was
  /// published for everything that happened. Anything else means the push side missed something,
  /// and the log line names which topic — which is the difference between this and a poll, because
  /// a poll repairs the same symptom and tells nobody.
  int mismatches = 0;

  bool get isConnected => _transport != null;

  void connected(UpdatesTransport transport) {
    _transport = transport;
    final topics = _listeners.keys.toList(growable: false);
    if (topics.isEmpty) return;
    final since = <String, int>{};
    for (final topic in topics) {
      final at = _cursors[topic];
      if (at != null) since[topic] = at;
    }
    transport.send(SubFrame(topics: topics, since: since));
    // We cannot know what happened while the socket was down until the server answers, and the
    // answer may be a gap. One fetch per reconnect is the cheap half of that trade.
    for (final topic in topics) {
      _fire(topic, SyncReason.reconnect);
    }
  }

  void disconnected() {
    _transport = null;
  }

  /// The app came back to the foreground. Everything being watched refetches once.
  ///
  /// This is the one backstop that should never be removed, and it is not a poll: it costs one
  /// fetch per time a human looks at the screen, which is bounded by the human. It is what covers
  /// the cases the digests deliberately leave out (an edit, a rename, a change that keeps every
  /// count the same) and the case where the OS suspended this process and it cannot know what it
  /// missed — which on a phone is most of the time.
  void refocused() {
    for (final topic in _listeners.keys.toList(growable: false)) {
      _fire(topic, SyncReason.reconnect);
    }
  }

  /// Subscribe. Returns the unsubscribe. Reference-counted per topic.
  VoidCallback subscribe(String topic, TopicListener listener) {
    var set = _listeners[topic];
    if (set == null) {
      set = <TopicListener>{};
      _listeners[topic] = set;
      _transport?.send(SubFrame(topics: [topic]));
    }
    set.add(listener);
    return () {
      final current = _listeners[topic];
      if (current == null) return;
      current.remove(listener);
      if (current.isNotEmpty) return;
      _listeners.remove(topic);
      _transport?.send(UnsubFrame(topics: [topic]));
    };
  }

  int? cursorOf(String topic) => _cursors[topic];

  /// Feed a parsed server frame in. Unknown frames never reach here (protocol.dart drops them).
  void handle(ServerFrame frame) {
    switch (frame) {
      case EventFrame(:final topic, :final seq, :final prev):
        final at = _cursors[topic];
        // The chain does not line up: something was published that never reached us. Refetching on
        // the spot beats finding out whenever the next check happens to run.
        final hole = prev != null && at != null && prev != at;
        _advance(topic, seq);
        _fire(topic, hole ? SyncReason.hole : SyncReason.event);

      case StateFrame(:final topic, :final seq, :final digest):
        _advance(topic, seq);
        _check(topic, digest);

      case GapFrame(:final topic, :final seq):
        if (seq != null) _advance(topic, seq);
        _fire(topic, SyncReason.gap);

      case AckFrame(:final granted, :final refused, :final cursors):
        this.refused.addAll(refused);
        granted.forEach(this.refused.remove);
        cursors.forEach((topic, seq) {
          // Only adopt a cursor we do not have. Never move ours backwards on an ack: our own
          // fetches may legitimately have seen further than the socket has told us about.
          _cursors.putIfAbsent(topic, () => seq);
        });

      case PongFrame():
      case ErrFrame():
        break;
    }
  }

  /// Compare what each subscriber holds against what the server says the answer is.
  ///
  /// A subscriber that holds nothing yet (null) is not a disagreement — it is mid-load, and
  /// telling it to refetch would just fight with the fetch already in flight.
  void _check(String topic, String expected) {
    final set = _listeners[topic];
    if (set == null) return;
    for (final listener in set.toList(growable: false)) {
      final mine = listener.digest?.call();
      if (mine == null || mine == expected) continue;
      mismatches += 1;
      debugPrint(
        'updates: $topic should be "$expected" but we hold "$mine" — refetching; '
        'an event for this was never delivered',
      );
      try {
        listener.onChange(SyncReason.mismatch);
      } catch (_) {
        // a listener that throws is that screen's bug, not everyone else's
      }
    }
  }

  void _advance(String topic, int seq) {
    final at = _cursors[topic];
    if (at == null || seq > at) _cursors[topic] = seq;
  }

  void _fire(String topic, SyncReason reason) {
    final set = _listeners[topic];
    if (set == null) return;
    for (final listener in set.toList(growable: false)) {
      try {
        listener.onChange(reason);
      } catch (_) {
        // A listener that throws is a bug in that screen; it must not stop the others from being
        // told, or one broken pane would silently freeze the rest of the app.
      }
    }
  }
}
