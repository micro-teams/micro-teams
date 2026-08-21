// The two time rules, which are easy to get subtly wrong and impossible to notice when you do.
//
// Ports of the React client's fmtListTime / fmtSep / gapTooBig. Every case here fixes a decision
// that already existed; none of them is new.

import 'package:flutter_test/flutter_test.dart';
import 'package:microteams/src/ui/chat_time.dart';

void main() {
  final now = DateTime(2026, 8, 21, 14, 30);

  group('the chat list stamp', () {
    test('is a clock for something from today', () {
      expect(listTime(DateTime(2026, 8, 21, 9, 5), now: now), '09:05');
    });

    test('is a date for anything older', () {
      expect(listTime(DateTime(2026, 8, 20, 23, 59), now: now), '08/20');
    });

    test('is a date across a year boundary, not a clock', () {
      // Same month and day, different year: comparing only month/day would call this "today".
      expect(listTime(DateTime(2025, 8, 21, 9, 5), now: now), '08/21');
    });
  });

  group('the separator between messages', () {
    test('carries the date once the day is not today', () {
      expect(
        separatorTime(DateTime(2026, 8, 19, 7, 2), now: now),
        '08/19 07:02',
      );
    });

    test('is just the clock today', () {
      expect(separatorTime(DateTime(2026, 8, 21, 7, 2), now: now), '07:02');
    });
  });

  group('when a separator is drawn', () {
    test(
      'always above the first message — there is nothing to compare with',
      () {
        expect(needsSeparator(null, DateTime(2026, 8, 21, 9, 0)), isTrue);
      },
    );

    test('not for messages inside the five-minute window', () {
      expect(
        needsSeparator(
          DateTime(2026, 8, 21, 9, 0),
          DateTime(2026, 8, 21, 9, 4, 59),
        ),
        isFalse,
      );
    });

    test('exactly five minutes apart is still one stretch, as before', () {
      // The React rule was `> 5 * 60 * 1000`, strictly greater. Flipping this to >= would redraw
      // separators all over a busy thread and look like a bug.
      expect(
        needsSeparator(
          DateTime(2026, 8, 21, 9, 0),
          DateTime(2026, 8, 21, 9, 5),
        ),
        isFalse,
      );
    });

    test('past five minutes opens a new one', () {
      expect(
        needsSeparator(
          DateTime(2026, 8, 21, 9, 0),
          DateTime(2026, 8, 21, 9, 5, 1),
        ),
        isTrue,
      );
    });
  });
}
