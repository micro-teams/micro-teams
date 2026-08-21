/// The chat list.
///
/// One widget for both layouts. On a phone it fills the screen and tapping a row pushes the
/// conversation; on a wide window the shell puts this beside the open conversation and tapping a
/// row swaps what is beside it. The list itself does not know which it is in — that is the whole
/// point of [onOpen], and it is why there is no second copy of this file for the desktop.
///
/// The row is the React `ChatRow`, ported rather than reinvented: a 48px rounded-square avatar (the
/// other person's in a 1:1, a member grid otherwise), title and time on one baseline, the last
/// message beneath it, and the separator drawn under the text column only — so it starts at the
/// text and not under the avatar. Every one of those is a decision someone already made, and
/// re-making them differently is how the two clients stopped looking like the same product.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mt_api/mt_api.dart';

import '../../app_providers.dart';
import '../../ui/avatar.dart';
import '../../ui/chat_time.dart';
import '../../ui/theme.dart';
import 'chats_controller.dart';

class ChatsScreen extends ConsumerWidget {
  const ChatsScreen({
    required this.onOpen,
    this.selectedId,
    this.dense = false,
    super.key,
  });

  final void Function(ChatSummary thread) onOpen;
  final int? selectedId;

  /// Beside an open conversation the list is the narrower, 14px variant the React desktop shell
  /// used; on a phone it is the roomier 16px one. Same widget, two measured densities — not two
  /// widgets, which is how the two shells drifted apart last time.
  final bool dense;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final chats = ref.watch(chatsProvider);
    final me = ref.watch(sessionProvider).value?.user.id;

    return chats.when(
      // Paint what we already know while the first answer is on its way. A spinner where a list
      // was a moment ago reads as loss, not as loading.
      loading: () => _List(
        threads: ref.read(chatsProvider.notifier).cached(),
        onOpen: onOpen,
        selectedId: selectedId,
        me: me,
        dense: dense,
        stale: true,
      ),
      error: (error, _) => Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('$error'),
            const SizedBox(height: 12),
            FilledButton.tonal(
              onPressed: () => ref.invalidate(chatsProvider),
              child: const Text('Try again'),
            ),
          ],
        ),
      ),
      data: (threads) => RefreshIndicator(
        onRefresh: () async => ref.invalidate(chatsProvider),
        child: _List(
          threads: threads,
          onOpen: onOpen,
          selectedId: selectedId,
          me: me,
          dense: dense,
          stale: false,
        ),
      ),
    );
  }
}

class _List extends StatelessWidget {
  const _List({
    required this.threads,
    required this.onOpen,
    required this.selectedId,
    required this.me,
    required this.dense,
    required this.stale,
  });

  final List<ChatSummary> threads;
  final void Function(ChatSummary thread) onOpen;
  final int? selectedId;
  final int? me;
  final bool dense;
  final bool stale;

  @override
  Widget build(BuildContext context) {
    if (threads.isEmpty) {
      if (stale) return const SizedBox.shrink();
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.forum_outlined,
              size: 32,
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
            const SizedBox(height: 8),
            Text(
              'no conversations yet',
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
      );
    }
    return ListView.builder(
      itemCount: threads.length,
      itemBuilder: (context, index) => _ChatRow(
        chat: threads[index],
        me: me,
        dense: dense,
        selected: threads[index].id == selectedId,
        onOpen: () => onOpen(threads[index]),
      ),
    );
  }
}

class _ChatRow extends StatelessWidget {
  const _ChatRow({
    required this.chat,
    required this.me,
    required this.dense,
    required this.selected,
    required this.onOpen,
  });

  final ChatSummary chat;
  final int? me;
  final bool dense;
  final bool selected;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;

    final members = chat.members.toList();
    final others = members.where((m) => m.userId != me).toList();
    final oneOnOne = members.length == 2 && others.length == 1;

    final title = chat.title.isNotEmpty
        ? chat.title
        : oneOnOne
        ? others.first.nickname
        : members.map((m) => m.nickname).join('、');

    final last = chat.lastMessage;
    final preview = last == null
        ? 'tap to open'
        : oneOnOne
        ? last.content
        : '${_nameOf(members, last.senderId) ?? ''}：${last.content}';

    return Material(
      color: selected ? scheme.surfaceContainerHighest : Colors.transparent,
      child: InkWell(
        onTap: onOpen,
        child: Padding(
          // 10/12, measured off the React row. The row's height is not set: it is whatever the
          // text column comes to, which is what makes the phone row taller than the dense one.
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              oneOnOne
                  ? UserAvatar(
                      userId: others.first.userId,
                      nickname: others.first.nickname,
                      avatarId: others.first.avatarId,
                      size: Metrics.avatarInList,
                    )
                  : MemberGridAvatar(
                      members: [
                        for (final m in members)
                          (
                            userId: m.userId,
                            nickname: m.nickname,
                            avatarId: m.avatarId,
                          ),
                      ],
                    ),
              const SizedBox(width: 12),
              Expanded(
                child: Container(
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  decoration: BoxDecoration(
                    border: Border(
                      bottom: BorderSide(color: scheme.outlineVariant),
                    ),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.baseline,
                        textBaseline: TextBaseline.alphabetic,
                        children: [
                          Expanded(
                            child: Text(
                              title,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: text.bodyLarge?.copyWith(
                                fontSize: dense
                                    ? Metrics.rowTitleDense
                                    : Metrics.rowTitlePhone,
                                height: dense ? 1.4 : 1.5,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Text(
                            listTime(last?.createdAt ?? chat.updatedAt),
                            style: text.labelSmall?.copyWith(
                              color: scheme.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ),
                      Text(
                        preview,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: text.bodyMedium?.copyWith(
                          fontSize: 14,
                          height: 1.4,
                          color: scheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  String? _nameOf(List<ChatMember> members, int userId) {
    for (final m in members) {
      if (m.userId == userId) return m.nickname;
    }
    return null;
  }
}
