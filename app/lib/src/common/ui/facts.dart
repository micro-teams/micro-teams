/// A list of facts: a label on the left, its value on the right.
///
/// The shape appears in several places — an agent's details, a machine's, who you are signed in as,
/// which build you are running — and it was written out by hand each time, so each one lined its
/// values up differently. This is that shape, once.
///
/// Two rules about the right-hand column, both of them things the eye notices before the reader
/// can say why:
///
///   * every value starts at the same x, so the column has a straight left edge to read down;
///   * the longest value ENDS at the right edge, so the block of values is pushed against the side
///     of the card rather than floating in the middle of it.
///
/// Those two together fix the column's position from the right: it is as wide as its widest value
/// and no wider. A row with something to tap — a chevron — keeps that thing at the far right of the
/// card whatever its own value's length, because a control that moves with the text is a control
/// you have to look for.
///
/// Lists in different cards can be bound together with a [FactColumn], so that the values in a
/// stack of cards share one left edge instead of each card finding its own.
library;

import 'package:flutter/material.dart';

/// One row.
class Fact {
  const Fact({
    required this.label,
    required this.value,
    this.trailing,
    this.onTap,
  });

  final String label;
  final String value;

  /// Pinned to the right edge of the card. Same width for every row in the group, so it is in the
  /// same place on the row that has one and the row that does not.
  final Widget? trailing;

  final VoidCallback? onTap;
}

/// Several lists that should line up with each other.
///
/// Holds the rows rather than the widgets, because the widths have to be known before the rows are
/// built: the whole point is that a list's own longest value does not decide the column alone.
///
/// The lists are assumed to be the same width on screen — a stack of cards in one column, which is
/// what this is for. Bound lists of different widths would share a left edge and lose the right.
class FactColumn {
  const FactColumn(this.lists);

  final List<List<Fact>> lists;

  Iterable<Fact> get _all => lists.expand((list) => list);
}

class FactList extends StatelessWidget {
  const FactList({required this.rows, this.group, super.key});

  final List<Fact> rows;

  /// The other lists this one lines up with. Null means it lines up with itself.
  final FactColumn? group;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLow,
        border: Border.all(color: scheme.outlineVariant),
        borderRadius: BorderRadius.circular(8),
      ),
      clipBehavior: Clip.antiAlias,
      child: BareFactList(rows: rows, group: group),
    );
  }
}

/// The rows without the box around them, for a card that draws its own.
class BareFactList extends StatelessWidget {
  const BareFactList({required this.rows, this.group, super.key});

  final List<Fact> rows;
  final FactColumn? group;

  static const double _side = 16;
  static const double _gap = 16;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final labelStyle = theme.textTheme.bodyMedium?.copyWith(
      color: scheme.onSurfaceVariant,
    );
    final valueStyle = theme.textTheme.bodyMedium;
    final scaler = MediaQuery.textScalerOf(context);
    final direction = Directionality.of(context);

    double widest(String Function(Fact) part, TextStyle? style) {
      var widest = 0.0;
      for (final fact in group?._all ?? rows) {
        final painter = TextPainter(
          text: TextSpan(text: part(fact), style: style),
          textDirection: direction,
          textScaler: scaler,
        )..layout();
        widest = widest > painter.width ? widest : painter.width;
      }
      return widest;
    }

    final labels = widest((fact) => fact.label, labelStyle);
    final values = widest((fact) => fact.value, valueStyle);
    // One width for every trailing widget in the group, so they are all in the same place. Sized
    // rather than measured: they are icons, and an icon of an unknown size would move the column.
    final anyTrailing = (group?._all ?? rows).any(
      (fact) => fact.trailing != null,
    );
    final trailing = anyTrailing ? 24.0 : 0.0;

    return LayoutBuilder(
      builder: (context, constraints) {
        final total = constraints.maxWidth;
        // Where the values start: as far right as their own longest line allows, so that the
        // longest one ends at the card's edge. A label long enough to reach that point pushes the
        // column back to the right of the labels, and the values wrap in what is left rather than
        // running under the labels.
        final afterLabels = _side + labels + _gap;
        final wanted = total - _side - trailing - values;
        final left = (wanted > afterLabels ? wanted : afterLabels).clamp(
          _side,
          total - _side - trailing,
        );
        final valueWidth = (total - _side - trailing - left).clamp(0.0, total);

        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (final (index, fact) in rows.indexed) ...[
              if (index > 0) Divider(height: 1, color: scheme.outlineVariant),
              _FactRow(
                fact: fact,
                labelStyle: labelStyle,
                valueStyle: valueStyle,
                valueLeft: left,
                valueWidth: valueWidth,
                trailingWidth: trailing,
              ),
            ],
          ],
        );
      },
    );
  }
}

class _FactRow extends StatelessWidget {
  const _FactRow({
    required this.fact,
    required this.labelStyle,
    required this.valueStyle,
    required this.valueLeft,
    required this.valueWidth,
    required this.trailingWidth,
  });

  final Fact fact;
  final TextStyle? labelStyle;
  final TextStyle? valueStyle;
  final double valueLeft;
  final double valueWidth;
  final double trailingWidth;

  @override
  Widget build(BuildContext context) {
    final row = Padding(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: valueLeft,
            child: Padding(
              padding: const EdgeInsets.only(left: BareFactList._side),
              child: Text(fact.label, style: labelStyle),
            ),
          ),
          SizedBox(
            width: valueWidth,
            child: Text(fact.value, style: valueStyle),
          ),
          if (trailingWidth > 0)
            SizedBox(
              width: trailingWidth,
              child: Align(
                alignment: Alignment.centerRight,
                child: fact.trailing,
              ),
            ),
          const SizedBox(width: BareFactList._side),
        ],
      ),
    );
    if (fact.onTap == null) return row;
    return InkWell(onTap: fact.onTap, child: row);
  }
}
