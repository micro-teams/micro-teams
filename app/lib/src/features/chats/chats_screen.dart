/// The chat list.
///
/// One widget for both layouts. On a phone it fills the screen and tapping a row pushes the
/// conversation; on a wide window the shell puts this beside the open conversation and tapping a
/// row swaps what is beside it. The list itself does not know which it is in — that is the whole
/// point of [onOpen], and it is why there is no second copy of this file for the desktop.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mt_api/mt_api.dart';

import 'chats_controller.dart';

class ChatsScreen extends ConsumerWidget {
  const ChatsScreen({required this.onOpen, this.selectedId, super.key});

  final void Function(ChatSummary thread) onOpen;
  final int? selectedId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final chats = ref.watch(chatsProvider);

    return chats.when(
      // Paint what we already know while the first answer is on its way. A spinner where a list
      // was a moment ago reads as loss, not as loading.
      loading: () => _List(
        threads: ref.read(chatsProvider.notifier).cached(),
        onOpen: onOpen,
        selectedId: selectedId,
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
    required this.stale,
  });

  final List<ChatSummary> threads;
  final void Function(ChatSummary thread) onOpen;
  final int? selectedId;
  final bool stale;

  @override
  Widget build(BuildContext context) {
    if (threads.isEmpty) {
      return Center(
        child: Text(
          stale ? '' : 'No conversations yet',
          style: Theme.of(context).textTheme.bodyMedium,
        ),
      );
    }
    return ListView.builder(
      itemCount: threads.length,
      itemBuilder: (context, index) {
        final thread = threads[index];
        final last = thread.lastMessage;
        return ListTile(
          selected: thread.id == selectedId,
          leading: CircleAvatar(
            child: Text(
              thread.title.isEmpty ? '?' : thread.title.characters.first,
            ),
          ),
          title: Text(
            thread.title,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          subtitle: last == null
              ? null
              : Text(
                  last.content,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
          onTap: () => onOpen(thread),
        );
      },
    );
  }
}
