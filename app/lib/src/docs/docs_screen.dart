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
                    onMoved: widget.onOpen,
                    showBack: false,
                  ),
          ),
        ],
      ),
    );
  }
}

class _TreePane extends ConsumerWidget {
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
  Widget build(BuildContext context, WidgetRef ref) {
    final tree = ref.watch(docsTreeProvider);
    final team = ref.watch(currentTeamProvider);
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: false,
        title: const Text('docs'),
        actions: [
          // Top-right, next to the actions, not a bar of its own under the title (T-007).
          TeamPickerAction(onManage: onManageTeams),
          IconButton(
            tooltip: 'new document',
            onPressed: team == null ? null : () => _create(context, ref),
            icon: const Icon(Icons.note_add_outlined),
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
                final rows = flatten(root, collapsed: collapsed);
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
                        node.isFolder && collapsed.contains(node.path);
                    return Material(
                      color: node.path == selected
                          ? scheme.surfaceContainerHighest
                          : Colors.transparent,
                      child: InkWell(
                        onTap: () => node.isFolder
                            ? onToggle(node.path)
                            : onOpen(node.path),
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
                                child: Text(
                                  nameOf(node.path),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: Theme.of(context).textTheme.bodyMedium,
                                ),
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

  Future<void> _create(BuildContext context, WidgetRef ref) async {
    final path = await promptForText(
      context,
      title: 'new document',
      hint: 'notes/idea.md',
      action: 'create',
    );
    if (path == null || path.isEmpty) return;
    await ref.read(docsAdminProvider).create(path, '# ${nameOf(path)}\n');
    onOpen(path);
  }
}

/// One document: read, or edited.
class _DocPane extends ConsumerStatefulWidget {
  const _DocPane({
    required this.path,
    required this.showBack,
    this.onBack,
    this.onMoved,
    super.key,
  });

  final String path;
  final bool showBack;
  final VoidCallback? onBack;

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
          PopupMenuButton<String>(
            itemBuilder: (context) => const [
              PopupMenuItem(value: 'rename', child: Text('rename or move')),
              PopupMenuItem(value: 'delete', child: Text('delete')),
            ],
            onSelected: (choice) =>
                choice == 'rename' ? _rename(context) : _delete(context),
          ),
        ],
      ),
      body: doc.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Text('$error', textAlign: TextAlign.center),
          ),
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

  Future<void> _rename(BuildContext context) async {
    final to = await promptForText(
      context,
      title: 'rename or move',
      hint: 'new path',
      action: 'move',
      initial: widget.path,
    );
    if (to == null || to.isEmpty || to == widget.path) return;
    await ref.read(docsAdminProvider).move(widget.path, to);
    // Follow it. You renamed a file you were reading, so you should still be reading it — and in
    // the wide layout there is nowhere to go "back" to, so the pane would otherwise sit on a path
    // that no longer exists.
    if (mounted) widget.onMoved?.call(to);
  }

  Future<void> _delete(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('delete ${nameOf(widget.path)}?'),
        content: const Text(
          'It stays in the repository history, but it goes from the tree.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('delete'),
          ),
        ],
      ),
    );
    if (!(confirmed ?? false)) return;
    await ref.read(docsAdminProvider).delete(widget.path);
    if (mounted) widget.onBack?.call();
  }
}
