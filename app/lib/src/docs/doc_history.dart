/// What happened to a document, and what each change actually was.
///
/// Documents are a git repository, so this is not a nicety: it is how a human finds out what an
/// agent changed while they were away. In the React client it existed on the phone and NOT on the
/// desktop — the surface where you would actually review a change — which is the kind of asymmetry
/// two shells produce and one shared screen cannot.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mt_api/mt_api.dart';

import 'docs_controller.dart';
import '../common/ui/app_dialog.dart';

Future<void> showDocHistory(BuildContext context, {required String path}) =>
    showAppDialog<void>(
      context,
      builder: (context) => AlertDialog(
        title: Text('history of ${nameOf(path)}'),
        content: SizedBox(
          width: 520,
          height: 420,
          child: DocHistory(path: path),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('close'),
          ),
        ],
      ),
    );

class DocHistory extends ConsumerWidget {
  const DocHistory({required this.path, super.key});

  final String path;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final history = ref.watch(docHistoryProvider(path));

    return history.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, _) => Center(child: Text('$error')),
      data: (commits) {
        if (commits.isEmpty) {
          return const Center(child: Text('no history'));
        }
        return ListView.separated(
          itemCount: commits.length,
          separatorBuilder: (context, _) => const Divider(height: 1),
          itemBuilder: (context, index) {
            final commit = commits[index];
            return ListTile(
              title: Text(
                commit.message,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
              subtitle: Text(
                '${commit.sha.substring(0, commit.sha.length.clamp(0, 7))} · '
                '${commit.author} · ${_when(commit.timestamp)}',
                style: const TextStyle(fontFamily: 'monospace', fontSize: 11),
              ),
              onTap: () => _showDiff(context, commit),
            );
          },
        );
      },
    );
  }

  Future<void> _showDiff(BuildContext context, DocCommit commit) =>
      showAppDialog<void>(
        context,
        builder: (context) => AlertDialog(
          title: Text(
            'diff ${commit.sha.substring(0, commit.sha.length.clamp(0, 7))}',
          ),
          content: SizedBox(
            width: 640,
            height: 420,
            child: _Diff(path: path, sha: commit.sha),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('close'),
            ),
          ],
        ),
      );

  /// The server sends epoch milliseconds; what a reader wants is when, not how many.
  static String _when(int timestamp) {
    final at = DateTime.fromMillisecondsSinceEpoch(timestamp).toLocal();
    String two(int n) => n.toString().padLeft(2, '0');
    return '${at.year}-${two(at.month)}-${two(at.day)} '
        '${two(at.hour)}:${two(at.minute)}';
  }
}

/// One commit's changes, coloured the way every other diff a programmer reads is coloured.
class _Diff extends ConsumerWidget {
  const _Diff({required this.path, required this.sha});

  final String path;
  final String sha;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final diff = ref.watch(docDiffProvider((path: path, sha: sha)));
    final scheme = Theme.of(context).colorScheme;

    return diff.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, _) => Center(child: Text('$error')),
      data: (text) {
        if (text.trim().isEmpty) {
          return const Center(child: Text('(no changes)'));
        }
        final lines = text.split('\n');
        return SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final line in lines)
                  Text(
                    line.isEmpty ? ' ' : line,
                    style: TextStyle(
                      fontFamily: 'monospace',
                      fontSize: 12,
                      height: 1.4,
                      color: _colourOf(line, scheme),
                    ),
                  ),
              ],
            ),
          ),
        );
      },
    );
  }

  /// `+++` and `---` are the file headers, not an added and a removed line. Colouring them like
  /// changes is how a diff of one file looks like a diff of three.
  static Color _colourOf(String line, ColorScheme scheme) {
    if (line.startsWith('+') && !line.startsWith('+++')) return scheme.primary;
    if (line.startsWith('-') && !line.startsWith('---')) return scheme.error;
    if (line.startsWith('@@')) return scheme.onSurface;
    return scheme.onSurfaceVariant;
  }
}
