/// A parsed mermaid flowchart, drawn.
///
/// Painted rather than built out of widgets: a diagram is one picture whose parts are positioned
/// against each other, and expressing that as nested boxes means fighting a layout system that is
/// trying to be helpful. It also means the whole thing measures itself once and scrolls as a unit.
///
/// What it will not do is guess. If [parseMermaid] could not read the source, the caller shows the
/// source — see mermaid.dart for why a half-drawn diagram is worse than an undrawn one.
library;

import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'mermaid.dart';

class MermaidView extends StatelessWidget {
  const MermaidView({required this.graph, super.key});

  final MermaidGraph graph;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final style = DefaultTextStyle.of(context).style.copyWith(fontSize: 13);
    final diagram = _Diagram.measure(
      graph,
      style,
      textDirection: TextDirection.ltr,
    );

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: SizedBox(
        width: diagram.size.width,
        height: diagram.size.height,
        child: CustomPaint(
          painter: _MermaidPainter(diagram: diagram, scheme: scheme),
        ),
      ),
    );
  }
}

/// One node's box, after measuring.
class _Box {
  const _Box({required this.node, required this.rect, required this.label});

  final MermaidNode node;
  final Rect rect;
  final TextPainter label;
}

/// Everything measured: where each box is, and how big the whole picture came out.
class _Diagram {
  const _Diagram({
    required this.boxes,
    required this.edges,
    required this.size,
    required this.edgeLabels,
    required this.ranks,
    required this.down,
  });

  /// Which rank each node ended up in, so an edge can tell whether it skips one.
  final Map<String, int> ranks;
  final bool down;

  int rankOf(String id) => ranks[id] ?? 0;

  final Map<String, _Box> boxes;
  final List<MermaidEdge> edges;
  final Map<MermaidEdge, TextPainter> edgeLabels;
  final Size size;

  static const double _gapAcross = 28;
  static const double _gapAlong = 56;
  static const double _padX = 16;
  static const double _padY = 12;
  static const double _margin = 12;

  static _Diagram measure(
    MermaidGraph graph,
    TextStyle style, {
    required TextDirection textDirection,
  }) {
    final layout = layOut(graph);
    final byId = {for (final node in graph.nodes) node.id: node};

    TextPainter paint(String text) => TextPainter(
      text: TextSpan(text: text, style: style),
      textDirection: textDirection,
      maxLines: 3,
    )..layout(maxWidth: 220);

    // Measure every label first: a rank's thickness is whatever its widest member needs.
    final labels = {for (final node in graph.nodes) node.id: paint(node.label)};
    final sizes = {
      for (final node in graph.nodes)
        node.id: Size(
          labels[node.id]!.width + _padX * 2,
          labels[node.id]!.height + _padY * 2,
        ),
    };

    final down = graph.direction == FlowDirection.down;
    final boxes = <String, _Box>{};
    var along = _margin;
    var widestAcross = 0.0;

    for (final rank in layout.ranks) {
      final thickness = rank
          .map((id) => down ? sizes[id]!.height : sizes[id]!.width)
          .fold(0.0, math.max);
      final across =
          rank
              .map((id) => down ? sizes[id]!.width : sizes[id]!.height)
              .fold(0.0, (sum, value) => sum + value) +
          _gapAcross * (rank.length - 1);
      widestAcross = math.max(widestAcross, across);

      var offset = 0.0;
      for (final id in rank) {
        final size = sizes[id]!;
        // Centred within the rank, so a diagram reads down its spine rather than along its left
        // edge — which is what makes a fan-out look like one.
        final start = -across / 2 + offset;
        final rect = down
            ? Rect.fromLTWH(start, along, size.width, size.height)
            : Rect.fromLTWH(along, start, size.width, size.height);
        boxes[id] = _Box(node: byId[id]!, rect: rect, label: labels[id]!);
        offset += (down ? size.width : size.height) + _gapAcross;
      }
      along += thickness + _gapAlong;
    }

    // Shift out of the negatives now that the extent is known, rather than guessing a centre.
    final shift = widestAcross / 2 + _margin;
    final shifted = {
      for (final entry in boxes.entries)
        entry.key: _Box(
          node: entry.value.node,
          rect: entry.value.rect.translate(down ? shift : 0, down ? 0 : shift),
          label: entry.value.label,
        ),
    };

    final edgeLabels = {
      for (final edge in graph.edges)
        if (edge.label != null)
          edge: (TextPainter(
            text: TextSpan(
              text: edge.label,
              style: style.copyWith(fontSize: 11),
            ),
            textDirection: textDirection,
          )..layout()),
    };

    // Room for a bowed edge, which reaches past the widest rank by design.
    const bow = 40.0;
    final size = down
        ? Size(widestAcross + _margin * 2 + bow, along - _gapAlong + _margin)
        : Size(along - _gapAlong + _margin, widestAcross + _margin * 2 + bow);

    return _Diagram(
      boxes: shifted,
      edges: graph.edges,
      edgeLabels: edgeLabels,
      size: size,
      ranks: {
        for (var i = 0; i < layout.ranks.length; i++)
          for (final id in layout.ranks[i]) id: i,
      },
      down: down,
    );
  }
}

class _MermaidPainter extends CustomPainter {
  const _MermaidPainter({required this.diagram, required this.scheme});

  final _Diagram diagram;
  final ColorScheme scheme;

  @override
  void paint(Canvas canvas, Size size) {
    final line = Paint()
      ..color = scheme.outline
      ..strokeWidth = 1.4
      ..style = PaintingStyle.stroke;
    final fill = Paint()..color = scheme.surfaceContainerHighest;
    final border = Paint()
      ..color = scheme.outlineVariant
      ..strokeWidth = 1.2
      ..style = PaintingStyle.stroke;

    // Edges first, so a line never crosses over the box it points at.
    for (final edge in diagram.edges) {
      final from = diagram.boxes[edge.from];
      final to = diagram.boxes[edge.to];
      if (from == null || to == null) continue;

      // An edge that skips a rank cannot be drawn straight: the straight line passes underneath
      // whatever sits between, and boxes are painted after edges — so the arrow simply disappears
      // and the diagram silently loses a connection. Those bow out to the side instead.
      final skips =
          (diagram.rankOf(edge.to) - diagram.rankOf(edge.from)).abs() > 1;
      final start = _edgePoint(from.rect, to.rect.center);
      final end = _edgePoint(to.rect, from.rect.center);
      final Offset middle;

      if (skips) {
        final via = diagram.down
            ? Offset(
                math.max(from.rect.right, to.rect.right) + 28,
                (start.dy + end.dy) / 2,
              )
            : Offset(
                (start.dx + end.dx) / 2,
                math.max(from.rect.bottom, to.rect.bottom) + 24,
              );
        canvas.drawPath(
          Path()
            ..moveTo(start.dx, start.dy)
            ..quadraticBezierTo(via.dx, via.dy, end.dx, end.dy),
          line,
        );
        if (edge.arrow) _arrowHead(canvas, via, end, line);
        // Where the curve actually is at its middle — not the midpoint of the straight line it is
        // avoiding, which is under a box.
        middle = Offset(
          0.25 * start.dx + 0.5 * via.dx + 0.25 * end.dx,
          0.25 * start.dy + 0.5 * via.dy + 0.25 * end.dy,
        );
      } else {
        canvas.drawLine(start, end, line);
        if (edge.arrow) _arrowHead(canvas, start, end, line);
        middle = Offset((start.dx + end.dx) / 2, (start.dy + end.dy) / 2);
      }

      final label = diagram.edgeLabels[edge];
      if (label != null) {
        final box = Rect.fromCenter(
          center: middle,
          width: label.width + 8,
          height: label.height + 2,
        );
        // The label sits ON the line, so it is painted over a patch of background: a line through
        // the middle of a word is how a diagram becomes unreadable at small sizes.
        canvas.drawRect(box, Paint()..color = scheme.surface);
        label.paint(canvas, box.topLeft + const Offset(4, 1));
      }
    }

    for (final box in diagram.boxes.values) {
      final rect = box.rect;
      switch (box.node.shape) {
        case NodeShape.rectangle:
          canvas
            ..drawRect(rect, fill)
            ..drawRect(rect, border);
        case NodeShape.rounded:
          final rounded = RRect.fromRectAndRadius(
            rect,
            Radius.circular(rect.height / 2),
          );
          canvas
            ..drawRRect(rounded, fill)
            ..drawRRect(rounded, border);
        case NodeShape.diamond:
          final path = Path()
            ..moveTo(rect.center.dx, rect.top)
            ..lineTo(rect.right, rect.center.dy)
            ..lineTo(rect.center.dx, rect.bottom)
            ..lineTo(rect.left, rect.center.dy)
            ..close();
          canvas
            ..drawPath(path, fill)
            ..drawPath(path, border);
      }
      box.label.paint(
        canvas,
        Offset(
          rect.center.dx - box.label.width / 2,
          rect.center.dy - box.label.height / 2,
        ),
      );
    }
  }

  /// Where a line leaves a box: the point on its edge in the direction of the other box, so lines
  /// touch the sides rather than starting somewhere inside.
  static Offset _edgePoint(Rect rect, Offset towards) {
    final centre = rect.center;
    final delta = towards - centre;
    if (delta.dx == 0 && delta.dy == 0) return centre;
    final scaleX = delta.dx == 0
        ? double.infinity
        : (rect.width / 2) / delta.dx.abs();
    final scaleY = delta.dy == 0
        ? double.infinity
        : (rect.height / 2) / delta.dy.abs();
    final scale = math.min(scaleX, scaleY);
    return centre + delta * scale;
  }

  static void _arrowHead(Canvas canvas, Offset from, Offset to, Paint paint) {
    final angle = math.atan2(to.dy - from.dy, to.dx - from.dx);
    const length = 9.0;
    const spread = 0.45;
    final head = Path()
      ..moveTo(to.dx, to.dy)
      ..lineTo(
        to.dx - length * math.cos(angle - spread),
        to.dy - length * math.sin(angle - spread),
      )
      ..moveTo(to.dx, to.dy)
      ..lineTo(
        to.dx - length * math.cos(angle + spread),
        to.dy - length * math.sin(angle + spread),
      );
    canvas.drawPath(head, paint);
  }

  @override
  bool shouldRepaint(_MermaidPainter old) =>
      old.diagram != diagram || old.scheme != scheme;
}
