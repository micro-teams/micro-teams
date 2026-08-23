// The panel that exists for the question "is it the network?".
//
// Everything MultiPath does is invisible when it works, which is what makes it hard to trust:
// nothing to see when it is fine, nothing to see when it is not. What this screen has to get right
// is the distinction the ranking itself turns on — a line nobody has measured is not a fast line.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:microteams/src/common/lines_screen.dart';
import 'package:microteams/src/common/ui/theme.dart';
import 'package:microteams/src/providers.dart';
import 'package:multipath/multipath.dart' as mp;

mp.LineManager _managerWith(mp.Registry registry) =>
    mp.LineManager(registry: registry);

Widget _host(mp.LineManager manager) => ProviderScope(
  overrides: [linesProvider.overrideWithValue(manager)],
  child: MaterialApp(theme: darkTheme(), home: const LinesScreen()),
);

void main() {
  testWidgets('every line is named, with where it goes', (tester) async {
    final manager = _managerWith(
      const mp.Registry([
        mp.Line(id: 'origin', transport: 'same-origin', weight: 100),
        mp.Line(
          id: 'frp-1',
          url: 'https://frp.example',
          transport: 'frp',
          weight: 80,
        ),
      ]),
    );
    await tester.pumpWidget(_host(manager));
    await tester.pumpAndSettle();

    expect(find.text('origin'), findsOneWidget);
    expect(find.text('frp-1'), findsOneWidget);
    expect(find.text('https://frp.example'), findsOneWidget);
    // The line the page itself came from has no URL, and saying "" would read as a missing value.
    expect(find.text('(this origin)'), findsOneWidget);
  });

  testWidgets('a line nobody has measured says so, rather than showing 0ms', (
    tester,
  ) async {
    // This is the distinction the ranking turns on: unknown is not the same as fast, and a panel
    // that printed 0ms would be saying the opposite of what the ranking believes.
    final manager = _managerWith(
      const mp.Registry([
        mp.Line(id: 'origin', transport: 'same-origin', weight: 100),
      ]),
    );
    await tester.pumpWidget(_host(manager));
    await tester.pumpAndSettle();

    expect(find.textContaining('never measured'), findsOneWidget);
    expect(find.textContaining('0ms'), findsNothing);
  });

  testWidgets('what was measured is shown once it is known', (tester) async {
    final manager = _managerWith(
      const mp.Registry([
        mp.Line(id: 'origin', transport: 'same-origin', weight: 100),
      ]),
    );
    manager.health.recordSuccess(
      'origin',
      const Duration(milliseconds: 42),
      DateTime.now(),
    );
    await tester.pumpWidget(_host(manager));
    await tester.pumpAndSettle();

    expect(find.textContaining('42ms'), findsOneWidget);
  });

  testWidgets('a failing line says what it said', (tester) async {
    // "It is down" is not enough to act on; what it answered is.
    final manager = _managerWith(
      const mp.Registry([
        mp.Line(id: 'origin', transport: 'same-origin', weight: 100),
      ]),
    );
    manager.health.recordFailure(
      'origin',
      StateError('origin answered 502'),
      DateTime.now(),
    );
    await tester.pumpWidget(_host(manager));
    await tester.pumpAndSettle();

    expect(find.textContaining('502'), findsOneWidget);
  });

  testWidgets('the refresh button measures rather than redraws', (
    tester,
  ) async {
    // The panel is a window onto the health table, and the table only fills in when something
    // probes. Before this the button called a helper that did one round by hand; now it asks the
    // manager, which is the thing that also runs the loop.
    var probed = 0;
    final manager = _managerWith(
      const mp.Registry([
        mp.Line(id: 'origin', transport: 'same-origin', weight: 100),
      ]),
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          linesProvider.overrideWithValue(manager),
          probeLinesProvider.overrideWithValue(() async => probed += 1),
        ],
        child: MaterialApp(theme: darkTheme(), home: const LinesScreen()),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byTooltip('measure now'));
    await tester.pumpAndSettle();

    expect(probed, 1);
  });
}
