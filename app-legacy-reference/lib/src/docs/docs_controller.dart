/// A team's document tree, and one file out of it.
///
/// Two providers rather than one, because they change on completely different rhythms: the tree
/// changes when somebody adds or moves a file, and a file's content changes on every keystroke
/// somebody else makes. Folding them together would mean refetching the whole tree to see a
/// character appear.
///
/// The tree is fetched recursively in one request. The React client did the same, and the reason is
/// worth keeping: a lazily-expanded tree needs one request per folder opened, which on a phone is a
/// visible stutter every time — and these are documents in a git repository, not a filesystem, so
/// the whole thing is small enough to send at once.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mt_api/mt_api.dart';

import '../common/team_scope.dart';
import '../common/updates/topics.dart';
import '../providers.dart';

/// The tree for the selected team, everything at once.
class DocsTreeController extends AsyncNotifier<DocNode?> {
  @override
  Future<DocNode?> build() async {
    final team = ref.watch(currentTeamProvider);
    if (team == null) return null;

    // Somebody else committing a file is exactly the event this screen exists to show.
    watchTopic(ref, teamTopic(team.id), onChange: (_) => ref.invalidateSelf());

    final response = await ref
        .read(mtClientProvider)
        .team
        .getDocument(id: team.id, path: '', recursive: true);
    return response.data;
  }
}

final docsTreeProvider = AsyncNotifierProvider<DocsTreeController, DocNode?>(
  DocsTreeController.new,
);

/// One file's content, by path.
class DocController extends FamilyAsyncNotifier<String, String> {
  @override
  Future<String> build(String arg) async {
    final team = ref.watch(currentTeamProvider);
    if (team == null || arg.isEmpty) return '';
    final response = await ref
        .read(mtClientProvider)
        .team
        .getDocument(id: team.id, path: arg, content: true);
    return response.data?.content ?? '';
  }

  /// Saves, and makes the tree ask again — a new file has to appear in it.
  ///
  /// The saved text becomes this provider's value directly rather than being refetched: the editor
  /// has it already, and a round trip here would blank the field for a frame under a slow line.
  Future<void> save(String content) async {
    final team = ref.read(currentTeamProvider);
    if (team == null) return;
    await ref
        .read(mtClientProvider)
        .team
        .writeDocument(id: team.id, path: arg, body: content);
    state = AsyncValue.data(content);
    ref.invalidate(docsTreeProvider);
  }
}

final docProvider = AsyncNotifierProvider.family<DocController, String, String>(
  DocController.new,
);

/// One file's commits, newest first.
///
/// Documents ARE a git repository, so history is a first-class thing to look at: it is how you find
/// out what an agent changed while you were away. Separate from [docProvider] because the content
/// changes on every save and the history is only asked for when somebody opens it.
final docHistoryProvider = FutureProvider.family<List<DocCommit>, String>((
  ref,
  path,
) async {
  final team = ref.watch(currentTeamProvider);
  if (team == null || path.isEmpty) return const [];
  final response = await ref
      .read(mtClientProvider)
      .team
      .getDocument(id: team.id, path: path, history: true);
  return response.data?.history?.toList() ?? const <DocCommit>[];
});

/// What one commit changed, as a unified diff.
final docDiffProvider =
    FutureProvider.family<String, ({String path, String sha})>((
      ref,
      ask,
    ) async {
      final team = ref.watch(currentTeamProvider);
      if (team == null) return '';
      final response = await ref
          .read(mtClientProvider)
          .team
          .getDocument(id: team.id, path: ask.path, diff: ask.sha);
      return response.data?.diff ?? '';
    });

/// The things you do to the tree rather than to a file's text.
class DocsAdmin {
  const DocsAdmin(this._ref);

  final Ref _ref;

  Future<void> create(String path, String content) async {
    final team = _ref.read(currentTeamProvider);
    if (team == null) return;
    await _ref
        .read(mtClientProvider)
        .team
        .writeDocument(id: team.id, path: path, body: content);
    _ref.invalidate(docsTreeProvider);
  }

  Future<void> move(String from, String to) async {
    final team = _ref.read(currentTeamProvider);
    if (team == null) return;
    await _ref
        .read(mtClientProvider)
        .team
        .moveDocument(
          id: team.id,
          path: from,
          moveDocumentRequest: MoveDocumentRequest(newPath: to),
        );
    // Both, and in this order: the old path's provider is now about a file that does not exist.
    _ref.invalidate(docProvider(from));
    _ref.invalidate(docsTreeProvider);
  }

  Future<void> delete(String path) async {
    final team = _ref.read(currentTeamProvider);
    if (team == null) return;
    await _ref
        .read(mtClientProvider)
        .team
        .deleteDocument(id: team.id, path: path);
    _ref.invalidate(docProvider(path));
    _ref.invalidate(docsTreeProvider);
  }
}

final docsAdminProvider = Provider<DocsAdmin>(DocsAdmin.new);

/// Which folders are open, and which row the reader last pointed at.
///
/// Outside the screen, and that is the whole reason it exists. Opening a document is a different
/// ROUTE, so the widget holding the tree is rebuilt from nothing — and the first document anybody
/// opened took the expansion state with it, folding the tree back up under them. It was invisible
/// while the default was "everything open", because a fresh empty set meant exactly that.
class DocsTreeView extends Notifier<({Set<String> expanded, String? touched})> {
  @override
  ({Set<String> expanded, String? touched}) build() =>
      (expanded: const {}, touched: null);

  void toggle(String path) {
    final next = {...state.expanded};
    if (!next.remove(path)) next.add(path);
    state = (expanded: next, touched: path);
  }

  /// The row a finger last landed on. On a desktop the pointer says which row you mean; a touch
  /// screen has no such thing, so the last tap has to say it instead — otherwise a folder's own
  /// actions are unreachable on a phone, which is where they were.
  void touch(String path) => state = (expanded: state.expanded, touched: path);
}

final docsTreeViewProvider =
    NotifierProvider<DocsTreeView, ({Set<String> expanded, String? touched})>(
      DocsTreeView.new,
    );

/// The tree flattened for display, deepest-last, folders before files at each level.
///
/// Done here rather than in the widget because it is a rule about documents, not about pixels, and
/// because a list is what a `ListView.builder` can be lazy about — a nested column of widgets is
/// built in full however little of it is on screen.
/// [expanded] holds the folders the reader has opened — everything else is closed, root included.
///
/// Open-by-default was the other way round, and it meant the first screen of a real repository was
/// a list of every file in it. Closed, the first screen is the shape of the project, which is the
/// thing you can navigate by. It also makes "what is open" the reader's own short list rather than
/// a growing record of what they have shut.
List<({DocNode node, int depth})> flatten(
  DocNode? root, {
  required Set<String> expanded,
}) {
  final rows = <({DocNode node, int depth})>[];

  void walk(List<DocNode> nodes, int depth) {
    final sorted = [...nodes]
      ..sort((a, b) {
        if (a.isFolder != b.isFolder) return a.isFolder ? -1 : 1;
        return a.path.toLowerCase().compareTo(b.path.toLowerCase());
      });
    for (final node in sorted) {
      rows.add((node: node, depth: depth));
      if (node.isFolder && expanded.contains(node.path)) {
        walk(node.children ?? const [], depth + 1);
      }
    }
  }

  // The root is a folder like any other — the team's own row in the tree — so a tree nobody has
  // opened shows nothing under it.
  if (!expanded.contains('')) return rows;
  walk(root?.children ?? const [], 0);
  return rows;
}

/// The last segment of a repo-relative path — what a row actually shows.
String nameOf(String path) {
  final slash = path.lastIndexOf('/');
  return slash == -1 ? path : path.substring(slash + 1);
}
