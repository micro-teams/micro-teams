// The merge rules, tested as plain functions — no widgets, no network.
//
// These are ported from the React client's merge tests because the cases are the record of what
// went wrong there: a refetch of the newest page throwing away the history someone had just
// scrolled up to load, and overlapping cursor pages duplicating messages. A rewrite that keeps the
// pagination but drops these tests keeps only the half that was easy to write.

import 'package:flutter_test/flutter_test.dart';
import 'package:microteams/src/features/chats/merge.dart';
import 'package:mt_api/mt_api.dart';

Message msg(int id) => Message(
  id: id,
  threadId: 7,
  senderId: 1,
  content: 'm$id',
  createdAt: DateTime.utc(2026, 8, 20),
);

List<int> ids(List<Message> messages) =>
    messages.map((m) => m.id).toList(growable: false);

void main() {
  group('mergeNewestPage', () {
    test('keeps history older than the page instead of dropping it', () {
      final held = [msg(1), msg(2), msg(3), msg(4)];
      // The newest page has moved on; 1 and 2 have fallen off it.
      final page = [msg(3), msg(4), msg(5)];

      expect(ids(mergeNewestPage(held, page)), [1, 2, 3, 4, 5]);
    });

    test('lets the page win inside the range it covers', () {
      final held = [msg(3), msg(4)];
      final edited = Message(
        id: 4,
        threadId: 7,
        senderId: 1,
        content: 'edited',
        createdAt: DateTime.utc(2026, 8, 20),
      );

      final merged = mergeNewestPage(held, [msg(3), edited]);

      expect(merged.last.content, 'edited');
    });

    test('an empty page changes nothing', () {
      final held = [msg(1), msg(2)];
      expect(ids(mergeNewestPage(held, const [])), [1, 2]);
    });
  });

  group('mergeOlderPage', () {
    test('prepends an older page in order', () {
      final held = [msg(10), msg(11)];
      expect(ids(mergeOlderPage(held, [msg(8), msg(9)])), [8, 9, 10, 11]);
    });

    test('ignores ids already held, because pages overlap', () {
      final held = [msg(9), msg(10)];
      expect(ids(mergeOlderPage(held, [msg(8), msg(9)])), [8, 9, 10]);
    });

    test('a page of nothing new is the same list', () {
      final held = [msg(9), msg(10)];
      expect(identical(mergeOlderPage(held, [msg(9)]), held), isTrue);
    });
  });

  group('threadDigest', () {
    test('is the newest id and the count over the shared window', () {
      final held = List.generate(150, (i) => msg(i + 1));
      expect(threadDigest(held, loading: false, window: 100), '150:100');
    });

    test('counts what it holds when that is less than the window', () {
      expect(
        threadDigest([msg(1), msg(2)], loading: false, window: 100),
        '2:2',
      );
    });

    test('says nothing while the first fetch is still in flight', () {
      // Answering "empty" here would disagree with the server and start a second fetch on top of
      // the one already running.
      expect(threadDigest(const [], loading: true, window: 100), isNull);
    });

    test('says empty once we know the thread really is empty', () {
      expect(threadDigest(const [], loading: false, window: 100), 'empty');
    });
  });
}
