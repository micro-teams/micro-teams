/// How a time is written in the chat list and between messages.
///
/// Both rules are ports of the React client's `fmtListTime` / `fmtSep` / `gapTooBig`, kept in one
/// file and unit-tested because "today shows a clock, another day shows a date" is exactly the
/// kind of rule that gets re-derived slightly differently in each place that needs it.
library;

/// Messages closer together than this share one time separator. Five minutes, as before.
const Duration separatorGap = Duration(minutes: 5);

bool needsSeparator(DateTime? previous, DateTime current) =>
    previous == null || current.difference(previous) > separatorGap;

String _twoDigits(int n) => n.toString().padLeft(2, '0');

String _clock(DateTime t) => '${_twoDigits(t.hour)}:${_twoDigits(t.minute)}';

bool _sameDay(DateTime a, DateTime b) =>
    a.year == b.year && a.month == b.month && a.day == b.day;

/// The chat list's right-hand stamp: a clock today, a date before that.
String listTime(DateTime when, {DateTime? now}) {
  final today = now ?? DateTime.now();
  final local = when.toLocal();
  return _sameDay(local, today)
      ? _clock(local)
      : '${_twoDigits(local.month)}/${_twoDigits(local.day)}';
}

/// The separator between messages: a clock today, a date and a clock before that.
String separatorTime(DateTime when, {DateTime? now}) {
  final today = now ?? DateTime.now();
  final local = when.toLocal();
  final clock = _clock(local);
  return _sameDay(local, today)
      ? clock
      : '${_twoDigits(local.month)}/${_twoDigits(local.day)} $clock';
}
