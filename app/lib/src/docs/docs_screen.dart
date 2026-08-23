/// The team's documents: the tree, and whatever is open out of it.
///
/// One responsive screen. On a phone the tree fills it and opening a file replaces it; on a wide
/// window they sit side by side and opening a file swaps the right-hand pane. The two arrangements
/// are the same two widgets — there is no desktop copy of this file, which is the mistake the React
/// client spent a refactor undoing.
///
/// Reading and editing are one screen with a switch rather than two routes. A document you have to
/// navigate away from to change is a document you stop changing.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mt_api/mt_api.dart';
import '../common/errors.dart';

import '../common/team_scope.dart';
import '../common/ui/team_picker.dart';
import '../common/ui/theme.dart';
import '../teams/teams_screen.dart' show promptForText;
import 'doc_history.dart';
import 'docs_controller.dart';
import 'markdown_view.dart';

class DocsScreen extends ConsumerStatefulWidget {
  const DocsScreen({
    this.openPath,
    required this.onOpen,
    required this.onManageTeams,
    super.key,
  });

  /// Go to team management, from the team picker in the header.
  final VoidCallback onManageTeams;

  /// The file being looked at, or null for just the tree.
  final String? openPath;

  final void Function(String? path) onOpen;

  @override
  ConsumerState<DocsScreen> createState() => _DocsScreenState();
}

class _DocsScreenState extends ConsumerState<DocsScreen> {
  /// Folders the reader has closed. Closed rather than open, so a fresh tree arrives expanded —
  /// which is what you want the first time and every time you have not said otherwise.
  final Set<String> _collapsed = {};

  @override
  Widget build(BuildContext context) {
    final wide = isWide(context);
    final open = widget.openPath;

    if (!wide && open != null) {
      return _DocPane(
        path: open,
        onBack: () => widget.onOpen(null),
        onClose: () => widget.onOpen(null),
        onMoved: widget.onOpen,
        showBack: true,
      );
    }

    final tree = _TreePane(
      collapsed: _collapsed,
      selected: open,
      onToggle: (path) => setState(() {
        if (!_collapsed.remove(path)) _collapsed.add(path);
      }),
      onOpen: widget.onOpen,
      onManageTeams: widget.onManageTeams,
    );

    if (!wide) return tree;

    return Scaffold(
      body: Row(
        children: [
          SizedBox(width: Metrics.listPaneWidth, child: tree),
          const VerticalDivider(width: 1),
          Expanded(
            child: open == null
                ? const Center(child: Text('pick a document'))
                : _DocPane(
                    key: ValueKey(open),
                    path: open,
                    onClose: () => widget.onOpen(null),
                    onMoved: widget.onOpen,
                    showBack: false,
                  ),
          ),
        ],
      ),
    );
  }
}

/// The tree, and everything you do TO the tree.
///
/// Creating, renaming, moving and deleting live here rather than in the header of an open document,
/// because they are operations on the tree: you rename a file you can see in it, and you create one
/// next to where you are looking. The React client put them here for the same reason. A "delete"
/// button in the corner of a document is also a delete button you meet while reading, which is not
/// where anyone wants to meet one.
///
/// Renaming happens IN PLACE — the row becomes a field and a tick. A dialog for a name is a frame
/// that has to be dismissed to see the thing you are naming.
class _TreePane extends ConsumerStatefulWidget {
  const _TreePane({
    required this.collapsed,
    required this.selected,
    required this.onToggle,
    required this.onOpen,
    required this.onManageTeams,
  });

  final VoidCallback onManageTeams;

  final Set<String> collapsed;
  final String? selected;
  final void Function(String path) onToggle;
  final void Function(String? path) onOpen;

  @override
  ConsumerState<_TreePane> createState() => _TreePaneState();
}

class _TreePaneState extends ConsumerState<_TreePane> {
  /// The path being renamed, or null. One at a time: two open fields in a tree is two ways to be
  /// half-way through something.
  String? _renaming;
  final _name = TextEditingController();

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final tree = ref.watch(docsTreeProvider);
    final team = ref.watch(currentTeamProvider);
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: false,
        title: const Text('docs'),
        actions: [
          // Top-right, next to the actions, not a bar of its own under the title (T-007).
          TeamPickerAction(onManage: widget.onManageTeams),
          // The root's actions. Every other node carries its own, on the row.
          if (team != null)
            PopupMenuButton<String>(
              tooltip: 'new',
              icon: const Icon(Icons.add),
              onSelected: (choice) => _create(folder: choice == 'folder'),
              itemBuilder: (context) => const [
                PopupMenuItem(value: 'file', child: Text('new file')),
                PopupMenuItem(value: 'folder', child: Text('new folder')),
              ],
            ),
        ],
      ),
      body: team == null
          ? Center(
              child: Text(
                'pick a team first',
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: scheme.onSurfaceVariant,
                ),
              ),
            )
          : tree.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (error, _) => Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Text('$error', textAlign: TextAlign.center),
                ),
              ),
              data: (root) {
                final rows = flatten(root, collapsed: widget.collapsed);
                if (rows.isEmpty) {
                  return Center(
                    child: Text(
                      'no documents yet',
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                  );
                }
                return ListView.builder(
                  itemCount: rows.length,
                  itemBuilder: (context, index) {
                    final row = rows[index];
                    final node = row.node;
                    final folded =
                        node.isFolder && widget.collapsed.contains(node.path);
                    return Material(
                      color: node.path == widget.selected
                          ? scheme.surfaceContainerHighest
                          : Colors.transparent,
                      child: InkWell(
                        onTap: () => node.isFolder
                            ? widget.onToggle(node.path)
                            : widget.onOpen(node.path),
                        child: Padding(
                          padding: EdgeInsets.fromLTRB(
                            12.0 + row.depth * 14,
                            8,
                            12,
                            8,
                          ),
                          child: Row(
                            children: [
                              Icon(
                                node.isFolder
                                    ? (folded
                                          ? Icons.folder_outlined
                                          : Icons.folder_open_outlined)
                                    : Icons.description_outlined,
                                size: 16,
                                color: scheme.onSurfaceVariant,
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: _renaming == node.path
                                    ? _NameField(
                                        controller: _name,
                                        onDone: () => _renameTo(node.path),
                                        onCancel: () =>
                                            setState(() => _renaming = null),
                                      )
                                    : Text(
                                        nameOf(node.path),
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: Theme.of(
                                          context,
                                        ).textTheme.bodyMedium,
                                      ),
                              ),
                              if (_renaming == node.path)
                                IconButton(
                                  tooltip: 'rename',
                                  visualDensity: VisualDensity.compact,
                                  onPressed: () => _renameTo(node.path),
                                  icon: const Icon(Icons.check, size: 18),
                                )
                              else
                                _NodeMenu(
                                  node: node,
                                  onSelected: (action) => _act(action, node),
                                ),
                            ],
                          ),
                        ),
                      ),
                    );
                  },
                );
              },
            ),
    );
  }

  /// A path's parent, or the empty string at the root — where a new sibling goes.
  static String _parentOf(String path) {
    final slash = path.lastIndexOf('/');
    return slash == -1 ? '' : path.substring(0, slash);
  }

  Future<void> _act(String action, DocNode node) async {
    // A folder's "new file" goes inside it; a file's goes beside it. That is what a person means by
    // pointing at one and asking for a new one.
    final within = node.isFolder ? node.path : _parentOf(node.path);
    switch (action) {
      case 'file':
        await _create(folder: false, within: within);
      case 'folder':
        await _create(folder: true, within: within);
      case 'rename':
        setState(() {
          _renaming = node.path;
          _name.text = nameOf(node.path);
        });
      case 'move':
        await _move(node);
      case 'delete':
        await _delete(node);
    }
  }

  Future<void> _create({required bool folder, String within = ''}) async {
    final name = await promptForText(
      context,
      title: folder ? 'new folder' : 'new file',
      hint: folder ? 'notes' : 'idea.md',
      action: 'create',
    );
    if (name == null || name.trim().isEmpty) return;
    final path = within.isEmpty ? name.trim() : '$within/${name.trim()}';
    // A folder in git is a folder with something in it, so a new one is created with a file that
    // says so. An empty folder would vanish the moment it was written.
    final target = folder ? '$path/README.md' : path;
    await ref.read(docsAdminProvider).create(target, '# ${nameOf(target)}\n');
    if (!folder) widget.onOpen(target);
  }

  Future<void> _renameTo(String path) async {
    final name = _name.text.trim();
    setState(() => _renaming = null);
    if (name.isEmpty || name == nameOf(path)) return;
    final parent = _parentOf(path);
    final to = parent.isEmpty ? name : '$parent/$name';
    await ref.read(docsAdminProvider).move(path, to);
    if (widget.selected == path) widget.onOpen(to);
  }

  Future<void> _move(DocNode node) async {
    final to = await promptForText(
      context,
      title: 'move ${nameOf(node.path)}',
      hint: 'notes/moved.md',
      action: 'move',
      initial: node.path,
    );
    if (to == null || to.isEmpty || to == node.path) return;
    await ref.read(docsAdminProvider).move(node.path, to);
    if (widget.selected == node.path) widget.onOpen(to);
  }

  Future<void> _delete(DocNode node) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('delete ${nameOf(node.path)}?'),
        content: Text(
          node.isFolder
              ? 'Everything in it goes too. It stays in the repository history.'
              : 'It stays in the repository history.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('delete'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    await ref.read(docsAdminProvider).delete(node.path);
    if (widget.selected == node.path) widget.onOpen(null);
  }
}

/// A row's own actions. The root's live in the header — it has no row.
class _NodeMenu extends StatelessWidget {
  const _NodeMenu({required this.node, required this.onSelected});

  final DocNode node;
  final void Function(String action) onSelected;

  @override
  Widget build(BuildContext context) => PopupMenuButton<String>(
    tooltip: 'actions',
    icon: const Icon(Icons.more_horiz, size: 18),
    padding: EdgeInsets.zero,
    onSelected: onSelected,
    itemBuilder: (context) => const [
      PopupMenuItem(value: 'file', child: Text('new file')),
      PopupMenuItem(value: 'folder', child: Text('new folder')),
      PopupMenuDivider(),
      PopupMenuItem(value: 'rename', child: Text('rename')),
      PopupMenuItem(value: 'move', child: Text('move')),
      PopupMenuDivider(),
      PopupMenuItem(value: 'delete', child: Text('delete')),
    ],
  );
}

/// A name being typed, in the place the name was.
class _NameField extends StatelessWidget {
  const _NameField({
    required this.controller,
    required this.onDone,
    required this.onCancel,
  });

  final TextEditingController controller;
  final VoidCallback onDone;
  final VoidCallback onCancel;

  @override
  Widget build(BuildContext context) => TextField(
    controller: controller,
    autofocus: true,
    style: Theme.of(context).textTheme.bodyMedium,
    decoration: const InputDecoration(
      isDense: true,
      contentPadding: EdgeInsets.symmetric(vertical: 4),
    ),
    onSubmitted: (_) => onDone(),
    onTapOutside: (_) => onCancel(),
  );
}

/// One document: read, or edited.
class _DocPane extends ConsumerStatefulWidget {
  const _DocPane({
    required this.path,
    required this.showBack,
    required this.onClose,
    this.onBack,
    this.onMoved,
    super.key,
  });

  final String path;
  final bool showBack;
  final VoidCallback? onBack;

  /// Stop showing this document. Not the same as [onBack], which exists only on the layout that has
  /// a back button: a file that is not there any more has to be closable on both.
  final VoidCallback onClose;

  /// The file is now at this path. The caller decides what that means — on both layouts it means
  /// opening it there.
  final void Function(String path)? onMoved;

  @override
  ConsumerState<_DocPane> createState() => _DocPaneState();
}

class _DocPaneState extends ConsumerState<_DocPane> {
  TextEditingController? _editor;
  bool _saving = false;

  bool get _editing => _editor != null;

  @override
  void dispose() {
    _editor?.dispose();
    super.dispose();
  }

  void _startEditing(String content) =>
      setState(() => _editor = TextEditingController(text: content));

  void _stopEditing() {
    final editor = _editor;
    setState(() => _editor = null);
    // After the frame, for the same reason the text prompt owns its controller: the field is still
    // being built while this rebuild settles.
    WidgetsBinding.instance.addPostFrameCallback((_) => editor?.dispose());
  }

  Future<void> _save() async {
    final editor = _editor;
    if (editor == null) return;
    setState(() => _saving = true);
    try {
      await ref.read(docProvider(widget.path).notifier).save(editor.text);
      if (mounted) _stopEditing();
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final doc = ref.watch(docProvider(widget.path));

    return Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: false,
        leading: widget.showBack
            ? IconButton(
                onPressed: widget.onBack,
                icon: const Icon(Icons.arrow_back),
              )
            : null,
        title: Text(nameOf(widget.path)),
        actions: [
          IconButton(
            tooltip: 'history',
            onPressed: () => showDocHistory(context, path: widget.path),
            icon: const Icon(Icons.history),
          ),
          if (_editing) ...[
            TextButton(onPressed: _stopEditing, child: const Text('cancel')),
            TextButton(
              onPressed: _saving ? null : _save,
              child: Text(_saving ? 'saving…' : 'save'),
            ),
          ] else
            IconButton(
              tooltip: 'edit',
              onPressed: doc.hasValue ? () => _startEditing(doc.value!) : null,
              icon: const Icon(Icons.edit_outlined),
            ),
          // Renaming, moving and deleting are not here. They are operations on the TREE and they
          // live in it — a delete button in the corner of a document is also a delete button you
          // meet while reading.
        ],
      ),
      body: doc.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => _DocProblem(
          error: error,
          path: widget.path,
          onClose: widget.onClose,
        ),
        data: (content) => Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: Metrics.readingColumn),
            child: _editing
                ? Padding(
                    padding: const EdgeInsets.all(12),
                    child: TextField(
                      controller: _editor,
                      maxLines: null,
                      expands: true,
                      textAlignVertical: TextAlignVertical.top,
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        fontSize: 13,
                        height: 1.5,
                      ),
                      decoration: const InputDecoration(
                        border: InputBorder.none,
                      ),
                    ),
                  )
                : SingleChildScrollView(
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
                    child: SelectionArea(
                      // One selection area, over a page that does not scroll while you drag in it —
                      // unlike the message list, where the same widget cost 125 frames in 274.
                      child: MarkdownView(source: content),
                    ),
                  ),
          ),
        ),
      ),
    );
  }
}

/// What is shown where a document would be when there is no document to show.
///
/// A file that is not in the tree any more is the ordinary case here — somebody deleted or renamed
/// it while this address was still open — and it is not really an error: it is an answer. Showing
/// the backend's exception name in the middle of the screen told the reader nothing about which
/// file was gone, and left them looking at a dead end with the tree one tap away and no hint of it.
class _DocProblem extends StatelessWidget {
  const _DocProblem({
    required this.error,
    required this.path,
    required this.onClose,
  });

  final Object error;
  final String path;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    final gone = error is MtError && (error as MtError).isNotFound;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              gone ? '$path is not in the tree any more' : '$error',
              textAlign: TextAlign.center,
            ),
            if (gone) ...[
              const SizedBox(height: 8),
              Text(
                'It was deleted or renamed. Its history is still in the repository.',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodySmall,
              ),
              const SizedBox(height: 16),
              TextButton(
                onPressed: onClose,
                child: const Text('back to the tree'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
