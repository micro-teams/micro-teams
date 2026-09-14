// The rules the fact list exists to keep, all of which are about the right-hand column.
//
// They are geometry, so they are measured rather than described: each of these fails if the column
// goes back to being laid out by a Spacer, which is where every one of them started.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:microteams/src/common/ui/facts.dart';
import 'package:microteams/src/common/ui/theme.dart';

const _rows = [
  Fact(label: 'machine id', value: 'm-1'),
  Fact(label: 'status', value: 'connected'),
  Fact(label: 'enrolled', value: '21 Aug 2026'),
];

Widget _host(Widget child) => MaterialApp(
  theme: darkTheme(),
  home: Scaffold(
    body: Center(child: SizedBox(width: 400, child: child)),
  ),
);

void _big(WidgetTester tester) {
  tester.view.physicalSize = const Size(900, 1200);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

void main() {
  testWidgets('every value starts at the same left edge', (tester) async {
    _big(tester);
    await tester.pumpWidget(_host(const FactList(rows: _rows)));
    await tester.pumpAndSettle();

    final lefts = _rows
        .map((fact) => tester.getTopLeft(find.text(fact.value)).dx)
        .toSet();
    expect(lefts, hasLength(1), reason: 'one column, one edge');
  });

  testWidgets('the longest value ends at the right edge', (tester) async {
    // Otherwise the block of values floats in the middle of the card, which is what a Spacer and a
    // right-aligned Text produce between them.
    _big(tester);
    await tester.pumpWidget(_host(const FactList(rows: _rows)));
    await tester.pumpAndSettle();

    final card = tester.getRect(find.byType(FactList));
    final longest = tester.getRect(find.text('21 Aug 2026')).right;
    expect(longest, closeTo(card.right - 16, 1.5));
  });

  testWidgets('bound lists share one left edge', (tester) async {
    // Two cards in a column — the profile's own details, and the build it is running — read as one
    // list of facts, so they line up as one.
    _big(tester);
    const first = [Fact(label: 'user id', value: '1')];
    const second = [Fact(label: 'version', value: '0.1.17-64ae475')];
    final group = const FactColumn([first, second]);

    await tester.pumpWidget(
      _host(
        Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            FactList(rows: first, group: group),
            FactList(rows: second, group: group),
          ],
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect({
      tester.getTopLeft(find.text('1')).dx,
      tester.getTopLeft(find.text('0.1.17-64ae475')).dx,
    }, hasLength(1));
  });

  testWidgets('a row that opens something keeps its chevron at the far right', (
    tester,
  ) async {
    _big(tester);
    const rows = [
      Fact(label: 'user id', value: '1'),
      Fact(
        label: 'version',
        value: '0.1.17',
        trailing: Icon(Icons.chevron_right, size: 16),
      ),
    ];

    await tester.pumpWidget(_host(const FactList(rows: rows)));
    await tester.pumpAndSettle();

    final card = tester.getRect(find.byType(FactList));
    expect(
      tester.getRect(find.byIcon(Icons.chevron_right)).right,
      closeTo(card.right - 16, 1.5),
      reason: 'a control that moves with the text is one you have to look for',
    );
  });
}
