// The panel that exists for the question "is it the network?".
//
// Everything the substrate does is invisible when it works, which is what makes it hard to trust:
// nothing to see when it is fine, and nothing to see when it is not. Under 0.2.0 that got harder
// rather than easier — a line can die without costing anybody a single error, so a deployment can
// lose most of its paths in silence. What this panel has to get right is therefore not a ranking any
// more (nothing ranks lines; every line carries every byte) but the three states a path can be in
// and the two facts that tell you it has been flapping.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:microteams/src/common/lines_screen.dart';
import 'package:microteams/src/common/multipath_adapter.dart';
import 'package:microteams/src/common/ui/theme.dart';
import 'package:microteams/src/providers.dart';
import 'package:multipath/multipath.dart' as mp;

/// A substrate that reports what a test says it reports.
///
/// Subclassed rather than injected through a seam, because the seam would exist only for this: the
/// real class asks its live transport, and there is no live transport in a widget test.
class _Reporting extends Substrate {
  _Reporting(this._stats, {super.lines = const []}) : super();

  final List<mp.LinkStat> _stats;

  @override
  List<mp.LinkStat> stats() => _stats;
}

Widget _host(Substrate substrate) => ProviderScope(
  overrides: [substrateProvider.overrideWithValue(substrate)],
  child: MaterialApp(theme: darkTheme(), home: const LinesScreen()),
);

void main() {
  testWidgets('every line is named, with where it goes', (tester) async {
    await tester.pumpWidget(
      _host(
        _Reporting(
          [mp.LinkStat(0, 'up', 0, 0, ''), mp.LinkStat(1, 'up', 0, 0, '')],
          lines: const ['', 'https://frp.example'],
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('line 0'), findsOneWidget);
    expect(find.text('line 1'), findsOneWidget);
    expect(find.text('https://frp.example'), findsOneWidget);
    // The line the page itself came from has no URL here, and printing "" would read as a missing
    // value rather than as the answer.
    expect(find.text('(this origin)'), findsOneWidget);
  });

  testWidgets('a line nothing has arrived on says so', (tester) async {
    // The distinction that matters on a cold start: a link that has connected but carried nothing
    // is not the same as one that is working, and a panel that showed a timestamp of zero would be
    // claiming a byte arrived in 1970.
    await tester.pumpWidget(
      _host(_Reporting([mp.LinkStat(0, 'connecting', 0, 0, '')])),
    );
    await tester.pumpAndSettle();

    expect(find.text('connecting'), findsOneWidget);
    expect(find.text('nothing has arrived on it'), findsOneWidget);
  });

  testWidgets('a line that has been flapping says how often', (tester) async {
    // The failure this panel is most likely to be the only witness to. A path that has died and
    // recovered forty times this morning reads as "up" at every instant somebody looks at it, and
    // the count is the only thing that gives it away.
    await tester.pumpWidget(
      _host(_Reporting([mp.LinkStat(0, 'up', 1757000000000, 40, '')])),
    );
    await tester.pumpAndSettle();

    expect(find.textContaining('recovered 40×'), findsOneWidget);
  });

  testWidgets('a dead line says what killed it', (tester) async {
    await tester.pumpWidget(
      _host(_Reporting([mp.LinkStat(0, 'down', 0, 3, 'i/o timeout')])),
    );
    await tester.pumpAndSettle();

    expect(find.text('down'), findsOneWidget);
    expect(find.text('i/o timeout'), findsOneWidget);
  });

  testWidgets('with no transport yet it says that, rather than nothing', (
    tester,
  ) async {
    // An empty panel and a panel that has not been asked look identical, and only one of them is a
    // reason to worry.
    await tester.pumpWidget(_host(_Reporting(const [])));
    await tester.pumpAndSettle();

    expect(find.textContaining('no transport yet'), findsOneWidget);
  });
}
