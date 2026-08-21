/// A conversation's members and settings.
///
/// Its own route (/chats/:id/info) rather than a sheet, because it is a place: a link to it is a
/// link somebody can send, and on a phone it is where every action that is not "type a message"
/// lives. The wide layout opens the same screen — one file, so the two arrangements cannot drift
/// into two different sets of actions the way the React shells did.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mt_api/mt_api.dart';

import '../common/ui/avatar.dart';
import '../providers.dart';
import 'thread_info_controller.dart';

class ThreadInfoScreen extends ConsumerWidget {
  const ThreadInfoScreen({
    required this.threadId,
    required this.onGone,
    super.key,
  });

  final int threadId;

  /// Called once the conversation no longer exists, so the caller can leave the route it was on.
  final VoidCallback onGone;

  Future<void> _rename(
    BuildContext context,
    WidgetRef ref,
    String current,
  ) async {
    final controller = TextEditingController(text: current);
    final title = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Rename chat'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(labelText: 'Title'),
          onSubmitted: (value) => Navigator.pop(context, value),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text),
            child: const Text('Rename'),
          ),
        ],
      ),
    );
    if (title == null || title.trim().isEmpty || !context.mounted) return;
    await _guard(
      context,
      () => ref.read(threadInfoProvider(threadId).notifier).rename(title),
    );
  }

  Future<void> _add(BuildContext context, WidgetRef ref) async {
    final controller = TextEditingController();
    final id = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Add someone'),
        content: TextField(
          controller: controller,
          autofocus: true,
          keyboardType: TextInputType.number,
          decoration: const InputDecoration(
            labelText: 'User id',
            helperText: 'the number on their profile',
          ),
          onSubmitted: (value) => Navigator.pop(context, value),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text),
            child: const Text('Add'),
          ),
        ],
      ),
    );
    final userId = int.tryParse((id ?? '').trim());
    if (userId == null || !context.mounted) return;
    await _guard(
      context,
      () => ref.read(threadInfoProvider(threadId).notifier).add(userId),
    );
  }

  Future<void> _dissolve(BuildContext context, WidgetRef ref) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete this chat?'),
        content: const Text(
          'It goes for everyone in it, along with every message.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true || !context.mounted) return;
    final ok = await _guard(
      context,
      () => ref.read(threadInfoProvider(threadId).notifier).dissolve(),
    );
    if (ok) onGone();
  }

  /// Runs one action, saying so if it fails. Returns whether it worked.
  Future<bool> _guard(
    BuildContext context,
    Future<void> Function() action,
  ) async {
    try {
      await action();
      return true;
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('$e')));
      }
      return false;
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final value = ref.watch(threadInfoProvider(threadId));
    final me = ref.watch(sessionProvider).valueOrNull?.user.id;
    final info = value.valueOrNull ?? const ThreadInfo();
    final canManage = info.canManage(me);

    return Scaffold(
      appBar: AppBar(title: const Text('Chat info')),
      body: value.isLoading && info.members.isEmpty
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Text(
                  info.title.isEmpty ? 'Untitled' : info.title,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                const SizedBox(height: 16),
                _MemberGrid(
                  members: info.ranked,
                  me: me,
                  canManage: canManage,
                  onAdd: canManage ? () => _add(context, ref) : null,
                  onRemove: (userId) => _guard(
                    context,
                    () => ref
                        .read(threadInfoProvider(threadId).notifier)
                        .remove(userId),
                  ),
                ),
                const SizedBox(height: 24),
                if (canManage)
                  OutlinedButton.icon(
                    onPressed: () => _rename(context, ref, info.title),
                    icon: const Icon(Icons.edit_outlined),
                    label: const Text('Rename chat'),
                  ),
                if (info.isOwner(me)) ...[
                  const SizedBox(height: 8),
                  TextButton.icon(
                    onPressed: () => _dissolve(context, ref),
                    style: TextButton.styleFrom(
                      foregroundColor: Theme.of(context).colorScheme.error,
                    ),
                    icon: const Icon(Icons.delete_outline),
                    label: const Text('Delete this chat'),
                  ),
                ],
              ],
            ),
    );
  }
}

/// Everyone in the conversation, as a grid of faces.
///
/// A grid rather than a list because a roster is scanned, not read: at five across you take in a
/// dozen people at a glance, which a list of rows never manages.
class _MemberGrid extends StatelessWidget {
  const _MemberGrid({
    required this.members,
    required this.me,
    required this.canManage,
    required this.onAdd,
    required this.onRemove,
  });

  final List<ThreadMember> members;
  final int? me;
  final bool canManage;

  /// Null when this human may not change the membership — the tile is absent rather than present
  /// and refusing.
  final VoidCallback? onAdd;
  final void Function(int userId) onRemove;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Wrap(
      spacing: 16,
      runSpacing: 16,
      children: [
        for (final member in members)
          SizedBox(
            width: 64,
            child: Column(
              children: [
                Stack(
                  clipBehavior: Clip.none,
                  children: [
                    UserAvatar(
                      userId: member.userId,
                      nickname: member.nickname ?? '',
                      avatarId: member.avatarId,
                      size: 56,
                    ),
                    // The owner cannot be removed, and you do not remove yourself here: leaving is
                    // a different act from being taken out, and it does not exist yet.
                    if (canManage &&
                        member.role != ThreadMemberRoleEnum.OWNER &&
                        member.userId != me)
                      Positioned(
                        right: -6,
                        top: -6,
                        child: IconButton(
                          iconSize: 16,
                          visualDensity: VisualDensity.compact,
                          tooltip: 'Remove user ${member.userId}',
                          onPressed: () => onRemove(member.userId),
                          icon: CircleAvatar(
                            radius: 10,
                            backgroundColor: scheme.error,
                            child: Icon(
                              Icons.close,
                              size: 12,
                              color: scheme.onError,
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 6),
                Text(
                  (member.nickname ?? '').isEmpty
                      ? 'user #${member.userId}'
                      : member.nickname!,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
          ),
        if (onAdd != null)
          SizedBox(
            width: 64,
            child: Column(
              children: [
                InkWell(
                  onTap: onAdd,
                  child: Container(
                    width: 56,
                    height: 56,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: scheme.outlineVariant),
                    ),
                    child: const Icon(Icons.add),
                  ),
                ),
                const SizedBox(height: 6),
                Text('add', style: Theme.of(context).textTheme.bodySmall),
              ],
            ),
          ),
      ],
    );
  }
}
