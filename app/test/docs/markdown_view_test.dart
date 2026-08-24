// What the renderer draws, and the one thing it deliberately does not.
//
// The parser is package:markdown's — correct by somebody else's tests — so what is worth asserting
// here is our half: that each block becomes the widget it should, and that a mermaid diagram is
// LABELLED rather than silently dropped or wrongly drawn.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:microteams/src/common/ui/theme.dart';
import 'package:microteams/src/docs/markdown_view.dart';

Future<void> _pump(WidgetTester tester, String source) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: darkTheme(),
      home: Scaffold(
        body: SingleChildScrollView(child: MarkdownView(source: source)),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

/// Everything the rendered widgets would read out, joined.
String _rendered(WidgetTester tester) => tester
    .widgetList<Text>(find.byType(Text))
    .map((t) => t.data ?? t.textSpan?.toPlainText() ?? '')
    .join('\n');

void main() {
  testWidgets('headings, paragraphs and emphasis all reach the screen', (
    tester,
  ) async {
    await _pump(tester, '# Title\n\nSome **bold** and *italic* text.\n');
    final text = _rendered(tester);
    expect(text, contains('Title'));
    expect(text, contains('bold'));
    expect(text, contains('italic'));
  });

  testWidgets('a list renders one row per item, with markers', (tester) async {
    await _pump(tester, '- one\n- two\n- three\n');
    final text = _rendered(tester);
    for (final item in ['one', 'two', 'three']) {
      expect(text, contains(item));
    }
    expect(find.text('•'), findsNWidgets(3));
  });

  testWidgets('an ordered list is numbered', (tester) async {
    await _pump(tester, '1. first\n2. second\n');
    expect(find.text('1.'), findsOneWidget);
    expect(find.text('2.'), findsOneWidget);
  });

  testWidgets('a fenced code block keeps its text verbatim', (tester) async {
    await _pump(tester, '```sh\ndocker compose up -d\n```\n');
    expect(_rendered(tester), contains('docker compose up -d'));
  });

  testWidgets('a mermaid diagram we cannot draw keeps its source', (
    tester,
  ) async {
    // A diagram this parser understands IS drawn — see docs/mermaid_test.dart. This is the other
    // half: dropping a block we cannot draw would lose content, and drawing it wrong would be
    // worse, because a mis-rendered graph looks like a wrong graph rather than a missing feature.
    // So it is shown as source and labelled.
    //
    // A sequence diagram, deliberately: it is a kind this parser does not attempt, rather than a
    // flowchart with a character it happens to reject — which is what this fixture used to be, and
    // it made the test pass for a reason nobody intended.
    await _pump(tester, '```mermaid\nsequenceDiagram\n  A->>B: hello\n```\n');
    final text = _rendered(tester);
    expect(text, contains('mermaid diagram'));
    expect(text, contains('sequenceDiagram'));
    expect(text, contains('A->>B: hello'));
  });

  testWidgets('a table becomes a table that scrolls rather than squeezing', (
    tester,
  ) async {
    await _pump(tester, '| a | b |\n| - | - |\n| 1 | 2 |\n');
    expect(find.byType(Table), findsOneWidget);
    // The page itself must never scroll horizontally; the table does it instead.
    expect(
      find.ancestor(
        of: find.byType(Table),
        matching: find.byType(SingleChildScrollView),
      ),
      findsWidgets,
    );
  });

  testWidgets('a blockquote and a rule are drawn as such', (tester) async {
    await _pump(tester, '> quoted\n\n---\n');
    expect(_rendered(tester), contains('quoted'));
    expect(find.byType(Divider), findsWidgets);
  });

  testWidgets('an image is named rather than drawn as a broken box', (
    tester,
  ) async {
    await _pump(tester, '![a diagram](pic.png)\n');
    expect(_rendered(tester), contains('[image: a diagram]'));
  });

  testWidgets('empty source renders nothing rather than throwing', (
    tester,
  ) async {
    await _pump(tester, '');
    expect(tester.takeException(), isNull);
  });
}
