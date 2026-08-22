// The mermaid subset: what it reads, and — more importantly — what it refuses to read.
//
// Refusing is the interesting half. A diagram drawn with a piece silently missing is worse than one
// not drawn at all, because a reader cannot tell which piece went missing. So anything outside the
// subset makes the WHOLE block fall back to its source, and these tests say where that line is.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:microteams/src/common/ui/theme.dart';
import 'package:microteams/src/docs/markdown_view.dart';
import 'package:microteams/src/docs/mermaid.dart';
import 'package:microteams/src/docs/mermaid_view.dart';

void main() {
  group('reading', () {
    test('a flowchart with labelled nodes and edges', () {
      final graph = parseMermaid('''
graph TD
  A[start] --> B{ok?}
  B -->|yes| C(done)
  B -->|no| A
''')!;

      expect(graph.direction, FlowDirection.down);
      expect(graph.nodes.map((n) => n.id), ['A', 'B', 'C']);
      expect(graph.nodes.first.label, 'start');
      expect(graph.nodes[1].shape, NodeShape.diamond);
      expect(graph.nodes[2].shape, NodeShape.rounded);
      expect(graph.edges, hasLength(3));
      expect(graph.edges[1].label, 'yes');
    });

    test('a node named once and referred to afterwards keeps its label', () {
      final graph = parseMermaid('''
flowchart LR
  A[the beginning]
  A --> B
  B --> A
''')!;

      expect(graph.direction, FlowDirection.right);
      expect(graph.nodes.first.label, 'the beginning');
      // B was only ever mentioned, so it is called what it was mentioned as.
      expect(graph.nodes[1].label, 'B');
    });

    test('a line without an arrow is still an edge, without the claim', () {
      final graph = parseMermaid('graph TD\n  A --- B')!;
      expect(graph.edges.single.arrow, isFalse);
    });

    test('quotes around a label are not part of it', () {
      final graph = parseMermaid('graph TD\n  A["a, with a comma"] --> B')!;
      expect(graph.nodes.first.label, 'a, with a comma');
    });
  });

  group('refusing', () {
    test('another kind of diagram entirely', () {
      expect(parseMermaid('sequenceDiagram\n  A->>B: hi'), isNull);
    });

    test('a flowchart with a subgraph in it', () {
      // Half of this one would draw. Half is the problem.
      expect(
        parseMermaid('graph TD\n  subgraph one\n  A --> B\n  end'),
        isNull,
      );
    });

    test('a direction it does not know', () {
      expect(parseMermaid('graph BT\n  A --> B'), isNull);
    });

    test('an empty block', () {
      expect(parseMermaid('   \n\n'), isNull);
    });
  });

  group('laying out', () {
    test('a node sits below everything that leads to it', () {
      // Longest path, not first mention: C is reached from A directly and through B, and it belongs
      // under B rather than beside it.
      final graph = parseMermaid('graph TD\n  A --> B\n  B --> C\n  A --> C')!;
      final layout = layOut(graph);

      expect(layout.rankOf('A'), 0);
      expect(layout.rankOf('B'), 1);
      expect(layout.rankOf('C'), 2);
    });

    test('a cycle is drawn rather than hung on', () {
      final graph = parseMermaid('graph TD\n  A --> B\n  B --> A')!;
      final layout = layOut(graph);
      expect(layout.ranks, isNotEmpty);
    });

    test('the order within a rank is the order they were written', () {
      // A diagram whose boxes move about between renders is one nobody can point at across a
      // conversation.
      final graph = parseMermaid('graph TD\n  A --> B\n  A --> C\n  A --> D')!;
      expect(layOut(graph).ranks[1], ['B', 'C', 'D']);
    });
  });

  group('in a document', () {
    testWidgets('a flowchart is drawn, not printed', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: darkTheme(),
          home: const Scaffold(
            body: MarkdownView(
              source: '```mermaid\ngraph TD\n  A[start] --> B[end]\n```',
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byType(MermaidView), findsOneWidget);
      expect(find.textContaining('graph TD'), findsNothing);
    });

    testWidgets('one it cannot read is still shown as source', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: darkTheme(),
          home: const Scaffold(
            body: MarkdownView(
              source: '```mermaid\nsequenceDiagram\n  A->>B: hi\n```',
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byType(MermaidView), findsNothing);
      expect(find.textContaining('sequenceDiagram'), findsOneWidget);
      expect(find.textContaining('not one we can draw yet'), findsOneWidget);
    });
  });
}
