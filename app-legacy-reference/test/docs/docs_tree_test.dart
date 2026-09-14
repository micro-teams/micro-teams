// How a git tree becomes a list you can scroll.
//
// `flatten` is where the ordering rules live — folders first, then alphabetical, depth carried
// alongside — and it is plain data, so it is tested as plain data rather than through a widget.
// It also has to be lazy-friendly: a nested column of widgets is built in full however little of it
// is on screen, which is why the tree is flattened at all.

import 'package:flutter_test/flutter_test.dart';
import 'package:microteams/src/docs/docs_controller.dart';
import 'package:mt_api/mt_api.dart';

DocNode folder(String path, List<DocNode> children) =>
    DocNode(path: path, isFolder: true, children: children);

DocNode file(String path) => DocNode(path: path, isFolder: false);

void main() {
  final tree = folder('', [
    file('README.md'),
    folder('notes', [file('notes/b.md'), file('notes/a.md')]),
    folder('archive', [file('archive/old.md')]),
  ]);

  test('folders come before files, and each group is alphabetical', () {
    final rows = flatten(tree, expanded: {'', 'notes', 'archive'});
    expect(rows.map((r) => r.node.path).toList(), [
      'archive',
      'archive/old.md',
      'notes',
      'notes/a.md',
      'notes/b.md',
      'README.md',
    ]);
  });

  test('depth is carried, so a row knows how far to indent', () {
    final rows = flatten(tree, expanded: {'', 'notes', 'archive'});
    expect(rows.firstWhere((r) => r.node.path == 'notes').depth, 0);
    expect(rows.firstWhere((r) => r.node.path == 'notes/a.md').depth, 1);
  });

  test(
    'a folder that has not been opened hides its children but stays itself',
    () {
      final rows = flatten(tree, expanded: {'', 'archive'});
      final paths = rows.map((r) => r.node.path).toList();
      expect(paths, contains('notes'));
      expect(paths, isNot(contains('notes/a.md')));
      expect(
        paths,
        contains('archive/old.md'),
        reason: 'only notes was closed',
      );
    },
  );

  test('nothing opened is nothing shown but the top level', () {
    // The default, and the point of it: a tree that arrives fully expanded is a list of every file
    // in the repository, with the one you came for somewhere in the middle.
    final rows = flatten(tree, expanded: {''});
    expect(rows.map((r) => r.node.path).toList(), [
      'archive',
      'notes',
      'README.md',
    ]);
    expect(
      flatten(tree, expanded: const {}),
      isEmpty,
      reason: 'the root itself is closed too',
    );
  });

  test('an empty tree is an empty list, not a crash', () {
    expect(flatten(null, expanded: {'', 'notes', 'archive'}), isEmpty);
    expect(
      flatten(folder('', const []), expanded: {'', 'notes', 'archive'}),
      isEmpty,
    );
  });

  group('nameOf', () {
    test('is the last segment', () {
      expect(nameOf('notes/2026/idea.md'), 'idea.md');
    });

    test('is the whole thing when there is no folder', () {
      expect(nameOf('README.md'), 'README.md');
    });
  });
}
