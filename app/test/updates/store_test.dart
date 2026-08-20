// The Dart half of frontend/src/lib/updates/store.test.ts, case for case.
//
// Ported rather than reimagined on purpose. These cases are the record of what the sync layer was
// found to get wrong — a cursor walking backwards, a hole on the very first event, an ack
// overwriting a cursor our own fetch had already moved past. A rewrite that keeps the protocol but
// drops its tests keeps only the half that was easy.

import 'package:flutter_test/flutter_test.dart';
import 'package:microteams/src/updates/protocol.dart';
import 'package:microteams/src/updates/store.dart';

class _Recorder implements UpdatesTransport {
  final List<Map<String, Object?>> sent = [];

  @override
  void send(ClientFrame frame) => sent.add(frame.toJson());
}

/// A listener that records why it was told to refetch.
class _Watcher {
  _Watcher({String? Function()? digest}) {
    listener = TopicListener(onChange: reasons.add, digest: digest);
  }

  final List<SyncReason> reasons = [];
  late final TopicListener listener;
}

void main() {
  group('UpdatesStore', () {
    test('tells a listener when its topic moves', () {
      final store = UpdatesStore();
      final watcher = _Watcher();
      store.subscribe('thread:7', watcher.listener);

      store.handle(const EventFrame(topic: 'thread:7', seq: 12));

      expect(watcher.reasons, [SyncReason.event]);
      expect(store.cursorOf('thread:7'), 12);
    });

    test("does not tell a listener about someone else's topic", () {
      final store = UpdatesStore();
      final watcher = _Watcher();
      store.subscribe('thread:7', watcher.listener);

      store.handle(const EventFrame(topic: 'thread:8', seq: 12));

      expect(watcher.reasons, isEmpty);
    });

    test('subscribes once for many listeners and unsubscribes on the last', () {
      final store = UpdatesStore();
      final transport = _Recorder();
      store.connected(transport);

      final first = _Watcher();
      final second = _Watcher();
      final dropFirst = store.subscribe('thread:7', first.listener);
      final dropSecond = store.subscribe('thread:7', second.listener);

      expect(transport.sent.where((f) => f['t'] == 'sub'), hasLength(1));

      dropFirst();
      expect(transport.sent.where((f) => f['t'] == 'unsub'), isEmpty);

      dropSecond();
      expect(transport.sent.where((f) => f['t'] == 'unsub'), hasLength(1));
    });

    test('resubscribes everything on reconnect, carrying its cursors', () {
      final store = UpdatesStore();
      final watcher = _Watcher();
      store.subscribe('thread:7', watcher.listener);
      store.handle(const EventFrame(topic: 'thread:7', seq: 42));

      final transport = _Recorder();
      store.connected(transport);

      final sub = transport.sent.firstWhere((f) => f['t'] == 'sub');
      expect(sub['topics'], ['thread:7']);
      expect(sub['since'], {'thread:7': 42});
    });

    test('treats a reconnect as a reason to refetch', () {
      final store = UpdatesStore();
      final watcher = _Watcher();
      store.subscribe('thread:7', watcher.listener);

      store.connected(_Recorder());

      expect(watcher.reasons, [SyncReason.reconnect]);
    });

    test('passes a gap on as its own reason', () {
      final store = UpdatesStore();
      final watcher = _Watcher();
      store.subscribe('thread:7', watcher.listener);

      store.handle(const GapFrame(topic: 'thread:7', seq: 99));

      expect(watcher.reasons, [SyncReason.gap]);
      expect(store.cursorOf('thread:7'), 99);
    });

    test('never walks a cursor backwards', () {
      final store = UpdatesStore();
      store.subscribe('thread:7', _Watcher().listener);

      store.handle(const EventFrame(topic: 'thread:7', seq: 50));
      store.handle(const EventFrame(topic: 'thread:7', seq: 30));

      expect(store.cursorOf('thread:7'), 50);
    });

    test('does not let an ack move a cursor we already hold', () {
      final store = UpdatesStore();
      store.subscribe('thread:7', _Watcher().listener);
      store.handle(const EventFrame(topic: 'thread:7', seq: 9134));

      store.handle(
        const AckFrame(
          granted: ['thread:7'],
          refused: [],
          cursors: {'thread:7': 0},
        ),
      );

      // Our own fetches may legitimately have seen further than the socket has told us about.
      expect(store.cursorOf('thread:7'), 9134);
    });

    test('records a refusal so it is not mistaken for a quiet topic', () {
      final store = UpdatesStore();

      store.handle(
        const AckFrame(granted: [], refused: ['team:9'], cursors: {}),
      );
      expect(store.refused, contains('team:9'));

      store.handle(
        const AckFrame(granted: ['team:9'], refused: [], cursors: {}),
      );
      expect(store.refused, isNot(contains('team:9')));
    });

    test('keeps telling the other listeners when one of them throws', () {
      final store = UpdatesStore();
      final good = _Watcher();
      store.subscribe(
        'thread:7',
        TopicListener(onChange: (_) => throw StateError('boom')),
      );
      store.subscribe('thread:7', good.listener);

      store.handle(const EventFrame(topic: 'thread:7', seq: 1));

      expect(good.reasons, [SyncReason.event]);
    });

    test('stops sending once disconnected and resends on the next connect', () {
      final store = UpdatesStore();
      final first = _Recorder();
      store.connected(first);
      store.subscribe('thread:7', _Watcher().listener);
      expect(first.sent.where((f) => f['t'] == 'sub'), hasLength(1));

      store.disconnected();
      store.subscribe('thread:8', _Watcher().listener);
      expect(first.sent.where((f) => f['t'] == 'sub'), hasLength(1));

      final second = _Recorder();
      store.connected(second);
      final sub = second.sent.firstWhere((f) => f['t'] == 'sub');
      expect(sub['topics'], containsAll(['thread:7', 'thread:8']));
    });
  });

  group('UpdatesStore verification', () {
    test('refetches when the event chain does not line up', () {
      final store = UpdatesStore();
      final watcher = _Watcher();
      store.subscribe('thread:7', watcher.listener);
      store.handle(const EventFrame(topic: 'thread:7', seq: 9120));

      // The server says the previous event was 9125; we never saw it.
      store.handle(const EventFrame(topic: 'thread:7', seq: 9134, prev: 9125));

      expect(watcher.reasons, [SyncReason.event, SyncReason.hole]);
    });

    test('does not cry hole on the first event it ever sees', () {
      final store = UpdatesStore();
      final watcher = _Watcher();
      store.subscribe('thread:7', watcher.listener);

      store.handle(const EventFrame(topic: 'thread:7', seq: 9134, prev: 9120));

      expect(watcher.reasons, [SyncReason.event]);
    });

    test('refetches and counts a mismatch when what we hold disagrees', () {
      final store = UpdatesStore();
      final watcher = _Watcher(digest: () => 'ours');
      store.subscribe('thread:7', watcher.listener);

      store.handle(
        const StateFrame(topic: 'thread:7', seq: 12, digest: 'theirs'),
      );

      expect(watcher.reasons, [SyncReason.mismatch]);
      expect(store.mismatches, 1);
    });

    test('says nothing when what we hold agrees', () {
      final store = UpdatesStore();
      final watcher = _Watcher(digest: () => 'same');
      store.subscribe('thread:7', watcher.listener);

      store.handle(
        const StateFrame(topic: 'thread:7', seq: 12, digest: 'same'),
      );

      expect(watcher.reasons, isEmpty);
      expect(store.mismatches, 0);
    });

    test(
      'does not treat a subscriber holding nothing yet as a disagreement',
      () {
        final store = UpdatesStore();
        final watcher = _Watcher(digest: () => null);
        store.subscribe('thread:7', watcher.listener);

        store.handle(
          const StateFrame(topic: 'thread:7', seq: 12, digest: 'theirs'),
        );

        expect(watcher.reasons, isEmpty);
        expect(store.mismatches, 0);
      },
    );

    test(
      'accepts a gap with no cursor — a server that knows it knows nothing',
      () {
        final store = UpdatesStore();
        final watcher = _Watcher();
        store.subscribe('thread:7', watcher.listener);

        store.handle(const GapFrame(topic: 'thread:7'));

        expect(watcher.reasons, [SyncReason.gap]);
        expect(store.cursorOf('thread:7'), isNull);
      },
    );
  });

  group('parseFrame', () {
    test('ignores a frame kind it has never heard of', () {
      expect(parseFrame('{"t":"something-new","topic":"thread:7"}'), isNull);
    });

    test('ignores malformed json rather than throwing', () {
      expect(parseFrame('{not json'), isNull);
    });

    test('ignores an event with no topic', () {
      expect(parseFrame('{"t":"event","seq":1}'), isNull);
    });

    test('reads an event', () {
      final frame = parseFrame(
        '{"t":"event","topic":"thread:7","seq":12,"prev":11,"kind":"message"}',
      );
      expect(
        frame,
        isA<EventFrame>()
            .having((f) => f.topic, 'topic', 'thread:7')
            .having((f) => f.seq, 'seq', 12)
            .having((f) => f.prev, 'prev', 11)
            .having((f) => f.kind, 'kind', 'message'),
      );
    });

    test('reads a state frame', () {
      final frame = parseFrame(
        '{"t":"state","topic":"chats:3","seq":8,"digest":"5/9134"}',
      );
      expect(
        frame,
        isA<StateFrame>()
            .having((f) => f.topic, 'topic', 'chats:3')
            .having((f) => f.digest, 'digest', '5/9134'),
      );
    });

    test('ignores a state frame with no digest', () {
      expect(parseFrame('{"t":"state","topic":"chats:3","seq":8}'), isNull);
    });

    test('survives an ack with fields missing', () {
      final frame = parseFrame('{"t":"ack"}');
      expect(
        frame,
        isA<AckFrame>()
            .having((f) => f.granted, 'granted', isEmpty)
            .having((f) => f.cursors, 'cursors', isEmpty),
      );
    });
  });
}
