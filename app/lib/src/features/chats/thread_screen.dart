/// One conversation.
///
/// The list is REVERSED: index 0 is the newest message and it sits at the bottom. That single
/// choice is what makes this screen shorter than its React counterpart — a reversed list opens at
/// the newest message with no scroll-to-bottom, stays there when a message arrives, and asks for
/// older history simply by reaching its own end. No scroll anchor, no pin-to-bottom rule, no
/// position restore after prepending.
///
/// The top of the list always says what it is doing — loading, or "the beginning" — because the
/// bug that would not die (T-073) was invisible: a reader who scrolls up and sees nothing cannot
/// tell "there is nothing older" from "this feature is broken".
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mt_api/mt_api.dart';

import '../../app_providers.dart';
import 'outbox.dart';
import 'thread_controller.dart';

class ThreadScreen extends ConsumerStatefulWidget {
  const ThreadScreen({required this.threadId, this.title, super.key});

  final int threadId;
  final String? title;

  @override
  ConsumerState<ThreadScreen> createState() => _ThreadScreenState();
}

class _ThreadScreenState extends ConsumerState<ThreadScreen> {
  final _composer = TextEditingController();
  final _scroll = ScrollController();

  @override
  void initState() {
    super.initState();
    _scroll.addListener(_onScroll);
  }

  @override
  void dispose() {
    _scroll.dispose();
    _composer.dispose();
    super.dispose();
  }

  /// In a reversed list, "scrolled to the top" is maxScrollExtent — the far end.
  void _onScroll() {
    if (!_scroll.hasClients) return;
    final position = _scroll.position;
    if (position.pixels > position.maxScrollExtent - 400) {
      unawaited(ref.read(threadProvider(widget.threadId).notifier).loadOlder());
    }
  }

  void _send() {
    final text = _composer.text;
    if (text.trim().isEmpty) return;
    ref.read(threadProvider(widget.threadId).notifier).send(text);
    _composer.clear();
  }

  @override
  Widget build(BuildContext context) {
    final thread = ref.watch(threadProvider(widget.threadId));
    final me = ref.watch(sessionProvider).value?.user.id;

    return Scaffold(
      appBar: AppBar(title: Text(widget.title ?? 'Conversation')),
      body: Column(
        children: [
          Expanded(
            child: thread.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (error, _) => _Failed(
                message: '$error',
                onRetry: () => ref.invalidate(threadProvider(widget.threadId)),
              ),
              data: (state) => _MessageList(
                state: state,
                me: me,
                scroll: _scroll,
                onRetry: (token) => ref
                    .read(threadProvider(widget.threadId).notifier)
                    .retry(token),
                onDiscard: (token) {
                  final text = ref
                      .read(threadProvider(widget.threadId).notifier)
                      .discard(token);
                  // A message someone gave up on goes back to the composer rather than vanishing.
                  if (text != null) _composer.text = text;
                },
              ),
            ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 4, 8, 8),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Expanded(
                    child: TextField(
                      controller: _composer,
                      minLines: 1,
                      maxLines: 6,
                      textInputAction: TextInputAction.newline,
                      decoration: const InputDecoration(hintText: 'Message'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton.filled(
                    onPressed: _send,
                    icon: const Icon(Icons.send),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _MessageList extends StatelessWidget {
  const _MessageList({
    required this.state,
    required this.me,
    required this.scroll,
    required this.onRetry,
    required this.onDiscard,
  });

  final ThreadState state;
  final int? me;
  final ScrollController scroll;
  final void Function(String clientToken) onRetry;
  final void Function(String clientToken) onDiscard;

  @override
  Widget build(BuildContext context) {
    // Reversed: pending first (they are the newest of all), then messages newest-first, then the
    // one row that says what is happening at the far end of history.
    final rows = <Widget>[
      for (final item in state.pending.reversed)
        _PendingBubble(
          pending: item,
          onRetry: () => onRetry(item.clientToken),
          onDiscard: () => onDiscard(item.clientToken),
        ),
      for (final message in state.messages.reversed)
        _Bubble(message: message, mine: message.senderId == me),
      _HistoryEdge(loading: state.loadingOlder, hasOlder: state.hasOlder),
    ];

    return ListView.builder(
      controller: scroll,
      reverse: true,
      padding: const EdgeInsets.symmetric(vertical: 12),
      itemCount: rows.length,
      itemBuilder: (context, index) => rows[index],
    );
  }
}

/// What is at the far end of the history we hold. Always visible, never silent.
class _HistoryEdge extends StatelessWidget {
  const _HistoryEdge({required this.loading, required this.hasOlder});

  final bool loading;
  final bool hasOlder;

  @override
  Widget build(BuildContext context) {
    final style = Theme.of(context).textTheme.bodySmall;
    final Widget child;
    if (loading) {
      child = Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const SizedBox(
            width: 14,
            height: 14,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
          const SizedBox(width: 8),
          Text('loading earlier messages', style: style),
        ],
      );
    } else if (hasOlder) {
      child = Text('scroll up for earlier messages', style: style);
    } else {
      child = Text('the beginning of this conversation', style: style);
    }
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 16),
      child: Center(child: child),
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.message, required this.mine});

  final Message message;
  final bool mine;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: const BoxConstraints(maxWidth: 560),
        margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 3),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: mine
              ? scheme.primaryContainer
              : scheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(16),
        ),
        child: SelectableText(message.content),
      ),
    );
  }
}

/// A message the server has not confirmed yet. Shown as sent, because as far as the user is
/// concerned it is — the outbox owes them delivery. It only starts apologising once it has been
/// failing long enough to be worth mentioning.
class _PendingBubble extends StatelessWidget {
  const _PendingBubble({
    required this.pending,
    required this.onRetry,
    required this.onDiscard,
  });

  final Pending pending;
  final VoidCallback onRetry;
  final VoidCallback onDiscard;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Align(
      alignment: Alignment.centerRight,
      child: Container(
        constraints: const BoxConstraints(maxWidth: 560),
        margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 3),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: scheme.primaryContainer.withValues(alpha: 0.55),
          borderRadius: BorderRadius.circular(16),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(pending.content),
            const SizedBox(height: 4),
            if (!pending.isStuck)
              Text('sending…', style: Theme.of(context).textTheme.labelSmall)
            else
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    pending.lastError ?? 'not sent yet',
                    style: Theme.of(
                      context,
                    ).textTheme.labelSmall?.copyWith(color: scheme.error),
                  ),
                  TextButton(onPressed: onRetry, child: const Text('Retry')),
                  TextButton(
                    onPressed: onDiscard,
                    child: const Text('Discard'),
                  ),
                ],
              ),
          ],
        ),
      ),
    );
  }
}

class _Failed extends StatelessWidget {
  const _Failed({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(message, textAlign: TextAlign.center),
          const SizedBox(height: 12),
          FilledButton.tonal(
            onPressed: onRetry,
            child: const Text('Try again'),
          ),
        ],
      ),
    );
  }
}

void unawaited(Future<void> future) {
  future.catchError((Object _) {});
}
