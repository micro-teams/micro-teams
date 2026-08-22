/// Markdown, rendered.
///
/// Parsed by `package:markdown` — Dart's own, the same parser `dart doc` uses — and turned into
/// widgets here. That split is deliberate: parsing markdown correctly is a large job with a right
/// answer, and drawing it is a small job with our answer. The alternative was a rendering package,
/// and the obvious one (`flutter_markdown`) is discontinued; taking a dependency that is already
/// being wound down, for a screen we intend to keep, is how the service-worker problem happened.
///
/// The subset is the React client's, which used `marked` and then restored typography in CSS for
/// exactly these: headings, emphasis, inline and fenced code, lists, blockquotes, rules, links,
/// tables, images.
///
/// ```mermaid``` is the honest compromise, and it is worth being explicit rather than quiet about
/// it: there is no Dart mermaid renderer, so a diagram is shown as its source with a label saying
/// so. A diagram drawn wrong would be worse — you cannot tell a mis-rendered graph from a wrong
/// one — and silently dropping the block would lose the content. See todo/microteams/backlog.md.
library;

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:markdown/markdown.dart' as md;

import 'mermaid.dart';
import 'mermaid_view.dart';

class MarkdownView extends StatelessWidget {
  const MarkdownView({required this.source, this.onOpenLink, super.key});

  final String source;

  /// Following a link is the shell's business, not this widget's.
  final void Function(String href)? onOpenLink;

  @override
  Widget build(BuildContext context) {
    final nodes = md.Document(
      extensionSet: md.ExtensionSet.gitHubWeb,
      encodeHtml: false,
    ).parseLines(const LineSplitter().convert(source));

    return _Renderer(context, onOpenLink).blocks(nodes);
  }
}

/// `LineSplitter` without importing dart:convert into every caller.
class LineSplitter {
  const LineSplitter();

  List<String> convert(String text) => text.split(RegExp(r'\r\n|\r|\n'));
}

class _Renderer {
  _Renderer(this.context, this.onOpenLink);

  final BuildContext context;
  final void Function(String href)? onOpenLink;

  ThemeData get theme => Theme.of(context);
  ColorScheme get scheme => theme.colorScheme;

  Widget blocks(List<md.Node> nodes) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [for (final node in nodes) block(node)],
  );

  Widget block(md.Node node) {
    if (node is md.Text) {
      // Whitespace between blocks. Rendering it would add stray blank lines.
      return node.text.trim().isEmpty
          ? const SizedBox.shrink()
          : _paragraph([node]);
    }
    if (node is! md.Element) return const SizedBox.shrink();

    switch (node.tag) {
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6':
        return _heading(node);
      case 'p':
        return _paragraph(node.children ?? const []);
      case 'pre':
        return _code(node);
      case 'blockquote':
        return _quote(node);
      case 'ul':
      case 'ol':
        return _list(node);
      case 'hr':
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 16),
          child: Divider(height: 1, color: scheme.outlineVariant),
        );
      case 'table':
        return _table(node);
      default:
        return blocks(node.children ?? const []);
    }
  }

  Widget _heading(md.Element node) {
    const sizes = {'h1': 24.0, 'h2': 20.0, 'h3': 17.0};
    final size = sizes[node.tag] ?? 15.0;
    final underlined = node.tag == 'h1';
    return Padding(
      padding: const EdgeInsets.only(top: 20, bottom: 8),
      child: Container(
        padding: underlined ? const EdgeInsets.only(bottom: 6) : null,
        decoration: underlined
            ? BoxDecoration(
                border: Border(
                  bottom: BorderSide(color: scheme.outlineVariant),
                ),
              )
            : null,
        child: Text.rich(
          TextSpan(children: inline(node.children ?? const [])),
          style: theme.textTheme.titleLarge?.copyWith(
            fontSize: size,
            height: 1.3,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }

  Widget _paragraph(List<md.Node> children) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 6),
    child: Text.rich(
      TextSpan(children: inline(children)),
      style: theme.textTheme.bodyMedium?.copyWith(fontSize: 14, height: 1.7),
    ),
  );

  /// A fenced block — or, when it is a mermaid flowchart this can read, the diagram itself.
  ///
  /// A block it cannot read stays exactly as it was: the source, labelled. That is not a
  /// placeholder for a renderer that never came, it is the honest answer — a diagram drawn with
  /// half its arrows missing is worse than one not drawn, because a reader cannot tell which half
  /// went missing. See mermaid.dart for what "can read" covers.
  Widget _code(md.Element node) {
    final code = node.children?.whereType<md.Element>().firstOrNull;
    final text = code?.textContent ?? node.textContent;
    final language = _languageOf(code);
    final isDiagram = language == 'mermaid';

    if (isDiagram) {
      final graph = parseMermaid(text);
      if (graph != null) {
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Container(
            width: double.infinity,
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: scheme.surfaceContainerHigh,
              borderRadius: BorderRadius.circular(8),
            ),
            child: MermaidView(graph: graph),
          ),
        );
      }
    }

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Container(
        width: double.infinity,
        decoration: BoxDecoration(
          color: scheme.surfaceContainerHigh,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (isDiagram)
              Container(
                width: double.infinity,
                padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
                child: Text(
                  'mermaid diagram — this one is not one we can draw yet, so '
                  'here is its source',
                  style: theme.textTheme.labelSmall?.copyWith(
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              ),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.all(12),
              child: Text(
                text.trimRight(),
                style: theme.textTheme.bodySmall?.copyWith(
                  fontSize: 13,
                  height: 1.5,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  String? _languageOf(md.Element? code) {
    final classes = code?.attributes['class'];
    if (classes == null) return null;
    for (final name in classes.split(' ')) {
      if (name.startsWith('language-')) {
        return name.substring('language-'.length);
      }
    }
    return null;
  }

  Widget _quote(md.Element node) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 8),
    child: Container(
      padding: const EdgeInsets.only(left: 12),
      decoration: BoxDecoration(
        border: Border(left: BorderSide(color: scheme.primary, width: 3)),
      ),
      child: DefaultTextStyle.merge(
        style: TextStyle(color: scheme.onSurfaceVariant),
        child: blocks(node.children ?? const []),
      ),
    ),
  );

  Widget _list(md.Element node) {
    final ordered = node.tag == 'ol';
    final items = (node.children ?? const []).whereType<md.Element>().toList();
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (var i = 0; i < items.length; i++)
            Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: 26,
                    child: Text(
                      ordered ? '${i + 1}.' : '•',
                      textAlign: TextAlign.right,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        fontSize: 14,
                        height: 1.7,
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(child: _listItem(items[i])),
                ],
              ),
            ),
        ],
      ),
    );
  }

  /// A list item's own text has no paragraph padding; nested blocks keep theirs.
  Widget _listItem(md.Element item) {
    final children = item.children ?? const [];
    final looseBlocks = children.whereType<md.Element>().where(
      (child) =>
          const {'p', 'ul', 'ol', 'pre', 'blockquote'}.contains(child.tag),
    );
    if (looseBlocks.isEmpty) {
      return Text.rich(
        TextSpan(children: inline(children)),
        style: theme.textTheme.bodyMedium?.copyWith(fontSize: 14, height: 1.7),
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final child in children)
          if (child is md.Element && child.tag == 'p')
            Text.rich(
              TextSpan(children: inline(child.children ?? const [])),
              style: theme.textTheme.bodyMedium?.copyWith(
                fontSize: 14,
                height: 1.7,
              ),
            )
          else
            block(child),
      ],
    );
  }

  /// Tables scroll sideways rather than squeezing. A table that wraps every cell to two characters
  /// is not readable, and the page itself must never scroll horizontally.
  Widget _table(md.Element node) {
    final rows = <TableRow>[];
    for (final section in (node.children ?? const []).whereType<md.Element>()) {
      final header = section.tag == 'thead';
      for (final row
          in (section.children ?? const []).whereType<md.Element>()) {
        rows.add(
          TableRow(
            children: [
              for (final cell
                  in (row.children ?? const []).whereType<md.Element>())
                Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 6,
                  ),
                  child: Text.rich(
                    TextSpan(children: inline(cell.children ?? const [])),
                    style: theme.textTheme.bodySmall?.copyWith(
                      fontSize: 13,
                      fontWeight: header ? FontWeight.w600 : null,
                    ),
                  ),
                ),
            ],
          ),
        );
      }
    }
    if (rows.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Table(
          defaultColumnWidth: const IntrinsicColumnWidth(),
          border: TableBorder.all(color: scheme.outlineVariant),
          children: rows,
        ),
      ),
    );
  }

  List<InlineSpan> inline(List<md.Node> nodes, {TextStyle? style}) {
    final spans = <InlineSpan>[];
    for (final node in nodes) {
      if (node is md.Text) {
        spans.add(TextSpan(text: _unescape(node.text), style: style));
        continue;
      }
      if (node is! md.Element) continue;
      final children = node.children ?? const [];
      switch (node.tag) {
        case 'em':
          spans.addAll(
            inline(
              children,
              style: (style ?? const TextStyle()).copyWith(
                fontStyle: FontStyle.italic,
              ),
            ),
          );
        case 'strong':
          spans.addAll(
            inline(
              children,
              style: (style ?? const TextStyle()).copyWith(
                fontWeight: FontWeight.w700,
              ),
            ),
          );
        case 'del':
          spans.addAll(
            inline(
              children,
              style: (style ?? const TextStyle()).copyWith(
                decoration: TextDecoration.lineThrough,
              ),
            ),
          );
        case 'code':
          spans.add(
            TextSpan(
              text: _unescape(node.textContent),
              style: (style ?? const TextStyle()).copyWith(
                backgroundColor: scheme.surfaceContainerHigh,
                fontSize: 13,
              ),
            ),
          );
        case 'a':
          final href = node.attributes['href'] ?? '';
          spans.add(
            TextSpan(
              text: node.textContent,
              style: (style ?? const TextStyle()).copyWith(
                color: scheme.primary,
                decoration: TextDecoration.underline,
                decorationColor: scheme.primary,
              ),
              recognizer: onOpenLink == null
                  ? null
                  : (TapGestureRecognizer()..onTap = () => onOpenLink!(href)),
            ),
          );
        case 'br':
          spans.add(const TextSpan(text: '\n'));
        case 'img':
          // Named rather than drawn: an image in a team's repository is served from an endpoint
          // this screen has no way to address yet, and a broken image box says less than this.
          spans.add(
            TextSpan(
              text:
                  '[image: ${node.attributes['alt'] ?? node.attributes['src'] ?? ''}]',
              style: (style ?? const TextStyle()).copyWith(
                color: scheme.onSurfaceVariant,
              ),
            ),
          );
        default:
          spans.addAll(inline(children, style: style));
      }
    }
    return spans;
  }

  /// The parser is asked not to encode HTML, but it still escapes a few entities.
  String _unescape(String text) => text
      .replaceAll('&amp;', '&')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"')
      .replaceAll('&#39;', "'");
}
