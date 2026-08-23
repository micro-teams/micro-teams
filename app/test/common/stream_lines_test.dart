// Which line carries a stream, and who gets the credit or the blame for how it went.

import 'package:flutter_test/flutter_test.dart';
import 'package:microteams/src/common/config.dart';
import 'package:microteams/src/common/stream_lines.dart';
import 'package:multipath/multipath.dart';

StreamLines _lines() => StreamLines(
  selector: StreamSelector(
    lines: () => parseRegistry({
      'lines': [
        {'id': 'near', 'url': 'https://near.example.com', 'weight': 100},
        {'id': 'far', 'url': 'https://far.example.com', 'weight': 90},
      ],
    }).lines,
  ),
  endpoints: const Endpoints(origin: 'https://origin.example.com'),
);

void main() {
  test('a stream is dialled over a line, not over the page origin', () {
    final dial = _lines().dial('/mt/machine/screen/abc');
    expect(dial.url, 'wss://near.example.com/mt/machine/screen/abc');
  });

  test('two streams at once each keep their own attempt', () {
    // One shared "the line I dialled" field would credit this screen's success to whatever the
    // other socket dialled last — a wrong answer that looks like a right one.
    final lines = _lines();
    final screen = lines.dial('/mt/machine/screen/abc');
    final updates = lines.dial('/mt/updates');
    expect(screen.line?.id, isNotNull);
    expect(updates.line?.id, isNotNull);

    final now = DateTime.utc(2026, 8, 23);
    screen.opened(now);
    screen.closed(now.add(const Duration(minutes: 5)));
    // The other attempt never opened, and saying so must not be confused with the first one's
    // five good minutes.
    updates.closed(now.add(const Duration(seconds: 1)));

    // A line that only ever failed to hold a stream stops being offered first.
    final next = lines.dial('/mt/updates');
    expect(next.line?.id, isNot(updates.line?.id));
  });

  test('one ending is reported once, however many times it is told', () {
    final lines = _lines();
    final first = lines.dial('/mt/updates');
    final now = DateTime.utc(2026, 8, 23);
    // A socket that errors and then completes is one ending; penalising it twice would take a
    // good line out of service for streams.
    first.closed(now);
    first.closed(now);
    final second = lines.dial('/mt/updates');
    second.opened(now);
    second.closed(now.add(const Duration(minutes: 1)));
    expect(lines.dial('/mt/updates').line?.id, second.line?.id);
  });
}
