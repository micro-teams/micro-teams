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

import '../providers.dart';
import '../common/ui/avatar.dart';
import 'chat_time.dart';
import '../common/ui/theme.dart';
import 'chats_controller.dart';

class ChatsScreen extends ConsumerWidget {
  const ChatsScreen({required this.onOpen, this.selectedId, super.key});

  final void Function(ChatSummary thread) onOpen;
  final int? selectedId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final chats = ref.watch(chatsProvider);
    final me = ref.watch(sessionProvider).valueOrNull?.user.id;

    // How roomy the rows are is measured from the width this list is GIVEN, not passed down by
    // whichever shell built it — and measured rather than read off the window, because beside an
    // open conversation this is a 320px column inside a 1400px window. Filling a phone it takes the
    // roomier variant; in that column it takes the 14px one the React desktop used. A shell that
    // had to say which would be a shell that knows what a chat row looks like.
    return LayoutBuilder(
      builder: (context, constraints) {
        final dense = constraints.maxWidth < Metrics.readingColumn;
        return _body(ref, chats, me, dense);
      },
    );
  }

  Widget _body(
    WidgetRef ref,
    AsyncValue<List<ChatSummary>> chats,
    int? me,
    bool dense,
  ) {
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
        // Keyed, so picking a conversation does not replace the row's element mid-ripple. Without
        // this the first tap looked like it did nothing: the row was rebuilt (it is now the
        // selected one) and the ink was thrown away before it could be drawn.
        key: ValueKey(threads[index].id),
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
    super.key,
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

    final avatarSize = dense ? Metrics.avatarInDenseList : Metrics.avatarInList;
    final members = chat.members.toList();
    final others = members.where((m) => m.userId != me).toList();
    final oneOnOne = members.length == 2 && others.length == 1;
    // A group whose only agent is one agent is shown with that agent's face: those are the rooms
    // where several people talk to one agent, and a grid of the humans says nothing about which
    // room it is. `isAgent` is null when the server was not asked — which is different from "asked,
    // and no", and is why this checks for true rather than for truthiness.
    final agents = members.where((m) => m.isAgent == true).toList();
    final publicAgent = !oneOnOne && agents.length == 1 ? agents.first : null;

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
          // The row's height is not set: it is whatever its contents come to, which is what makes
          // the phone row taller than the dense one. There is no rule under the text — the React
          // row had one and it earns nothing: the avatar column already separates the rows.
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (oneOnOne || publicAgent != null)
                UserAvatar(
                  userId: (publicAgent ?? others.first).userId,
                  nickname: (publicAgent ?? others.first).nickname,
                  avatarId: (publicAgent ?? others.first).avatarId,
                  size: avatarSize,
                )
              else
                MemberGridAvatar(
                  size: avatarSize,
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
