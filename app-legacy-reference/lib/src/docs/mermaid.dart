/// Enough of mermaid to draw the diagrams these documents actually contain.
///
/// There is no mermaid renderer for Flutter, and the two ways out are not equal. Mounting
/// mermaid.js behind an HtmlElementView would draw everything — on the web, and nowhere else,
/// leaving the five other platforms looking at source. This client exists so that one codebase
/// serves six platforms; a hole cut for one of them keeps leaking.
///
/// So this parses the subset that agents and humans here actually write — a flowchart with
/// labelled nodes and labelled edges — and draws it. Everything else stays exactly as it was: the
/// labelled source block, which is honest about what it is. A diagram half-drawn would be worse
/// than one not drawn, because a reader cannot tell which half was dropped.
///
/// What is supported, deliberately narrow:
///
///   * `graph`/`flowchart` with a direction of TD, TB or LR;
///   * nodes as `A[square]`, `A(rounded)` or `A{diamond}`, declared on their own or inline in an
///     edge, and referred to afterwards by id;
///   * edges `A --> B`, `A --- B`, and either with a label: `A -->|yes| B`.
///
/// Anything else — subgraphs, class definitions, click handlers, other diagram types — makes the
/// whole block unsupported rather than partly drawn.
library;

import 'dart:math' as math;

enum NodeShape { rectangle, rounded, diamond }

enum FlowDirection { down, right }

class MermaidNode {
  const MermaidNode({
    required this.id,
    required this.label,
    required this.shape,
  });

  final String id;
  final String label;
  final NodeShape shape;
}

class MermaidEdge {
  const MermaidEdge({
    required this.from,
    required this.to,
    this.label,
    this.arrow = true,
  });

  final String from;
  final String to;
  final String? label;

  /// `-->` has one, `---` does not. The difference is whether the diagram is claiming a direction.
  final bool arrow;
}

class MermaidGraph {
  const MermaidGraph({
    required this.direction,
    required this.nodes,
    required this.edges,
  });

  final FlowDirection direction;

  /// In declaration order, which is also the order they are laid out within a rank — a diagram
  /// whose boxes move about between renders is a diagram nobody can point at.
  final List<MermaidNode> nodes;
  final List<MermaidEdge> edges;
}

final RegExp _header = RegExp(
  r'^\s*(graph|flowchart)\s+(TD|TB|LR)\s*$',
  caseSensitive: false,
);

/// One edge, with an optional label, and a node declaration on either side.
final RegExp _edge = RegExp(
  r'^\s*(\w+)\s*(\[[^\]]*\]|\([^)]*\)|\{[^}]*\})?\s*'
  r'(-->|---)\s*'
  r'(?:\|([^|]*)\|\s*)?'
  r'(\w+)\s*(\[[^\]]*\]|\([^)]*\)|\{[^}]*\})?\s*;?\s*$',
);

/// A node on a line of its own.
final RegExp _node = RegExp(
  r'^\s*(\w+)\s*(\[[^\]]*\]|\([^)]*\)|\{[^}]*\})\s*;?\s*$',
);

/// Parse, or return null — which means "show the source", not "show half a diagram".
MermaidGraph? parseMermaid(String source) {
  final lines = source
      .split('\n')
      .map((line) => line.trim())
      .where((line) => line.isNotEmpty && !line.startsWith('%%'))
      .toList();
  if (lines.isEmpty) return null;

  final header = _header.firstMatch(lines.first);
  if (header == null) return null;
  final direction = header.group(2)!.toUpperCase() == 'LR'
      ? FlowDirection.right
      : FlowDirection.down;

  final nodes = <String, MermaidNode>{};
  final order = <String>[];
  final edges = <MermaidEdge>[];

  void declare(String id, String? decoration) {
    final existing = nodes[id];
    if (existing != null && decoration == null) return;
    if (existing != null && existing.label != id && decoration == null) return;
    final (label, shape) = decoration == null
        ? (id, NodeShape.rectangle)
        : _decorationOf(decoration);
    // A later declaration with a label wins over the bare id an edge implied.
    if (existing == null) order.add(id);
    nodes[id] = MermaidNode(id: id, label: label, shape: shape);
  }

  for (final line in lines.skip(1)) {
    final edge = _edge.firstMatch(line);
    if (edge != null) {
      declare(edge.group(1)!, edge.group(2));
      declare(edge.group(5)!, edge.group(6));
      final label = edge.group(4)?.trim();
      edges.add(
        MermaidEdge(
          from: edge.group(1)!,
          to: edge.group(5)!,
          label: label == null || label.isEmpty ? null : label,
          arrow: edge.group(3) == '-->',
        ),
      );
      continue;
    }

    final node = _node.firstMatch(line);
    if (node != null) {
      declare(node.group(1)!, node.group(2));
      continue;
    }

    // Something this does not understand. Better to hand the whole block back as source than to
    // draw a diagram that is quietly missing a piece.
    return null;
  }

  if (order.isEmpty) return null;
  return MermaidGraph(
    direction: direction,
    nodes: [for (final id in order) nodes[id]!],
    edges: edges,
  );
}

(String, NodeShape) _decorationOf(String decoration) {
  final inner = decoration.substring(1, decoration.length - 1).trim();
  final label = _unquote(inner);
  return switch (decoration[0]) {
    '(' => (label, NodeShape.rounded),
    '{' => (label, NodeShape.diamond),
    _ => (label, NodeShape.rectangle),
  };
}

String _unquote(String text) =>
    (text.startsWith('"') && text.endsWith('"') && text.length >= 2)
    ? text.substring(1, text.length - 1)
    : text;

/// Where each node goes, in ranks.
///
/// The rank is the longest path from a node with nothing pointing at it, which is what puts a node
/// BELOW everything that leads to it rather than beside the first thing that happened to mention
/// it. Cycles are given the rank they had when first reached, so a loop draws rather than hangs.
class MermaidLayout {
  const MermaidLayout(this.ranks);

  /// Node ids, by rank.
  final List<List<String>> ranks;

  int rankOf(String id) {
    for (var i = 0; i < ranks.length; i++) {
      if (ranks[i].contains(id)) return i;
    }
    return 0;
  }
}

MermaidLayout layOut(MermaidGraph graph) {
  final rank = <String, int>{for (final node in graph.nodes) node.id: 0};
  final incoming = <String, int>{for (final node in graph.nodes) node.id: 0};
  for (final edge in graph.edges) {
    incoming[edge.to] = (incoming[edge.to] ?? 0) + 1;
  }

  // Longest path, relaxed until nothing moves — bounded by the node count, which is what stops a
  // cycle from running forever.
  for (var pass = 0; pass < graph.nodes.length; pass++) {
    var moved = false;
    for (final edge in graph.edges) {
      final next = (rank[edge.from] ?? 0) + 1;
      if (next > (rank[edge.to] ?? 0) && next < graph.nodes.length) {
        rank[edge.to] = next;
        moved = true;
      }
    }
    if (!moved) break;
  }

  final depth = rank.values.isEmpty ? 0 : rank.values.reduce(math.max);
  final ranks = List.generate(depth + 1, (_) => <String>[]);
  // Declaration order within a rank: a diagram whose boxes move between renders is one nobody can
  // point at across a conversation.
  for (final node in graph.nodes) {
    ranks[rank[node.id] ?? 0].add(node.id);
  }
  return MermaidLayout(ranks);
}

/// Whether an edge has to go round rather than straight.
///
/// A straight line between ranks that are not neighbours passes underneath whatever sits between
/// them — and boxes are painted after edges, so the line disappears and the diagram silently loses
/// a connection. Found by rendering one and looking at it; no test was going to say so, which is
/// why it is a rule here now rather than a shape in the painter.
bool bowsAround(int fromRank, int toRank) => (toRank - fromRank).abs() > 1;
