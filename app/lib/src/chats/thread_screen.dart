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
///
/// The bubbles are the React client's, deliberately: same greens, same 72% cap, same tail, same
/// five-minute rule for time separators, same avatar-outside-the-bubble layout. This is the screen
/// people spend their day in, and it is the one place where "close enough" is not.
///
/// Two things here are about frames rather than looks, and both are load-bearing:
///
///   * rows are computed as DATA and turned into widgets inside `itemBuilder`. The first cut built
///     a `List<Widget>` of every message on every rebuild, which does all the work `ListView
///     .builder` exists to avoid — and it did it again on each arriving message.
///   * message text IS selectable, with one `SelectionArea` around the list, and you copy with
///     whatever your system uses to copy. This is a deliberate reversal, and the cost is on the
///     record: measured against a 300-message conversation in a browser, that `SelectionArea`
///     dropped 125 of 274 frames while scrolling (p95 50ms against a 16.7ms budget) where having
///     none dropped zero. It went back in because copying half a message — or a code fence out of
///     an agent's reply — is something people do constantly here, and "long-press copies the whole
///     bubble" cannot do it at all. The list is still virtualised, so what is in the selection tree
///     is what is on screen; if this ever feels heavy on a real phone, that measurement is where to
///     start, not this comment.
library;

import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mt_api/mt_api.dart';

import '../providers.dart';
import '../common/ui/avatar.dart';
import 'chat_time.dart';
import '../common/ui/theme.dart';
import 'outbox.dart';
import 'thread_controller.dart';
import 'thread_info_controller.dart';

class ThreadScreen extends ConsumerStatefulWidget {
  const ThreadScreen({
    required this.threadId,
    this.title,
    this.asPane = false,
    this.onOpenScreen,
    this.onOpenInfo,
    super.key,
  });

  final int threadId;
  final String? title;

  /// True when this sits BESIDE the chat list rather than replacing it.
  ///
  /// A pane has no back button and no centred title, because nothing was entered: picking a
  /// different conversation is picking, not navigating. The React desktop shell drew it exactly
  /// this way, and the first cut got a back arrow purely because Material adds one whenever the
  /// router could pop — which says something about the history stack, not about the layout.
  final bool asPane;

  /// Opens an agent's live screen. Supplied by the router, because a screen does not navigate — it
  /// says what happened and the shell decides where that goes.
  final void Function(String sessionId)? onOpenScreen;

  /// Open this conversation's members and settings. Null in a context that has nowhere to open it.
  final VoidCallback? onOpenInfo;

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
    final me = ref.watch(sessionProvider).valueOrNull?.user.id;
    final infoValue = ref.watch(threadInfoProvider(widget.threadId));
    final info = infoValue.valueOrNull ?? const ThreadInfo();

    return Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: !widget.asPane,
        title: Text(_title(info, me, settled: !infoValue.isLoading)),
        actions: [
          if (widget.onOpenInfo != null)
            IconButton(
              tooltip: 'Chat info',
              onPressed: widget.onOpenInfo,
              icon: const Icon(Icons.info_outline),
            ),
        ],
      ),
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
                info: info,
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
          _Composer(controller: _composer, onSend: _send),
        ],
      ),
    );
  }

  /// A group is called by its title; a direct chat is called by the other person. Same rule as the
  /// chat list, which is why a 1:1 does not read "thread #12" in one place and a name in the other.
  /// [settled] is whether the roster has actually answered. While it has not, the title is EMPTY
  /// rather than "chat #12": a placeholder that is replaced a moment later reads as the app
  /// changing its mind about what you opened, which is worse than a header that fills in.
  String _title(ThreadInfo info, int? me, {required bool settled}) {
    if (widget.title != null && widget.title!.isNotEmpty) return widget.title!;
    if (info.title.isNotEmpty) return info.title;
    final others = info.others(me);
    if (others.length == 1) return others.first.nickname ?? 'chat';
    if (others.isNotEmpty) {
      return others.map((m) => m.nickname ?? '?').join('、');
    }
    return settled ? 'chat #${widget.threadId}' : '';
  }
}

/// One row of the list, as data. Turning these into widgets is [_MessageList]'s `itemBuilder`.
sealed class _Row {
  const _Row();
}

class _PendingRow extends _Row {
  const _PendingRow(this.pending);
  final Pending pending;
}

class _MessageRow extends _Row {
  const _MessageRow(this.message, {required this.separator});
  final Message message;

  /// The time to draw above this message, or null when it is close enough to the one before it.
  final String? separator;
}

class _EdgeRow extends _Row {
  const _EdgeRow();
}

class _MessageList extends StatelessWidget {
  const _MessageList({
    required this.state,
    required this.me,
    required this.info,
    required this.scroll,
    required this.onRetry,
    required this.onDiscard,
  });

  final ThreadState state;
  final int? me;
  final ThreadInfo info;
  final ScrollController scroll;
  final void Function(String clientToken) onRetry;
  final void Function(String clientToken) onDiscard;

  /// Reversed: pending first (they are the newest of all), then messages newest-first, then the
  /// one row that says what is happening at the far end of history.
  List<_Row> _rows() {
    final rows = <_Row>[
      for (final item in state.pending.reversed) _PendingRow(item),
    ];
    final messages = state.messages;
    for (var i = messages.length - 1; i >= 0; i--) {
      final message = messages[i];
      // The separator belongs to the message that OPENS a new stretch of time, so it is decided by
      // looking at the older neighbour — which, walking backwards, is the next index down.
      final previous = i > 0 ? messages[i - 1].createdAt : null;
      rows.add(
        _MessageRow(
          message,
          separator: needsSeparator(previous, message.createdAt)
              ? separatorTime(message.createdAt)
              : null,
        ),
      );
    }
    rows.add(const _EdgeRow());
    return rows;
  }

  @override
  Widget build(BuildContext context) {
    final rows = _rows();
    // One selection area around the list, so a drag runs across bubbles the way it does on a web
    // page and the system's own copy is what copies. See this file's header for what it costs.
    return _ReadingColumn(
      child: SelectionArea(
        child: ListView.builder(
          controller: scroll,
          reverse: true,
          padding: const EdgeInsets.symmetric(vertical: 8),
          itemCount: rows.length,
          itemBuilder: (context, index) {
            final row = rows[index];
            return switch (row) {
              _PendingRow(:final pending) => _PendingBubble(
                pending: pending,
                onRetry: () => onRetry(pending.clientToken),
                onDiscard: () => onDiscard(pending.clientToken),
              ),
              _MessageRow(:final message, :final separator) => _Bubble(
                message: message,
                mine: message.senderId == me,
                name: info.nameOf(message.senderId),
                avatarId: info.avatarOf(message.senderId),
                // A 1:1 does not need the other person's name written above every bubble; there is
                // only one other person, and their avatar is right there.
                showName: message.senderId != me && info.members.length > 2,
                separator: separator,
              ),
              _EdgeRow() => _HistoryEdge(
                loading: state.loadingOlder,
                hasOlder: state.hasOlder,
              ),
            };
          },
        ),
      ),
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

/// The centred, sparse time between stretches of conversation.
class _TimeSeparator extends StatelessWidget {
  const _TimeSeparator(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Center(
        child: Text(
          text,
          style: Theme.of(context).textTheme.labelSmall?.copyWith(
            color: Theme.of(context).colorScheme.onSurfaceVariant,
            fontSize: 11,
          ),
        ),
      ),
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({
    required this.message,
    required this.mine,
    required this.name,
    required this.avatarId,
    required this.showName,
    required this.separator,
  });

  final Message message;
  final bool mine;
  final String name;
  final int? avatarId;
  final bool showName;
  final String? separator;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (separator != null) _TimeSeparator(separator!),
        Padding(
          padding: const EdgeInsets.fromLTRB(10, 3, 10, 3),
          child: Row(
            textDirection: mine ? TextDirection.rtl : TextDirection.ltr,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              UserAvatar(
                userId: message.senderId,
                nickname: name,
                avatarId: avatarId,
                size: Metrics.avatarInBubble,
              ),
              const SizedBox(width: 8),
              Flexible(
                child: Column(
                  crossAxisAlignment: mine
                      ? CrossAxisAlignment.end
                      : CrossAxisAlignment.start,
                  children: [
                    if (showName)
                      Padding(
                        padding: const EdgeInsets.only(left: 4, bottom: 2),
                        child: Text(
                          name,
                          style: Theme.of(context).textTheme.labelSmall
                              ?.copyWith(
                                color: Theme.of(
                                  context,
                                ).colorScheme.onSurfaceVariant,
                              ),
                        ),
                      ),
                    _BubbleWidth(
                      child: _BubbleBody(
                        text: message.content,
                        mine: mine,
                        background: mine ? ownBubble : otherBubble,
                        foreground: mine ? ownBubbleInk : otherBubbleInk,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

/// 72% of the column the conversation is drawn in — not of the window.
///
/// The first cut used a flat 560px cap, which on a phone is wider than the screen: every bubble
/// filled its row, so "mine" and "theirs" looked identically left-aligned. Reading the code said
/// it was correct; only measuring said otherwise.
class _BubbleWidth extends StatelessWidget {
  const _BubbleWidth({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) => ConstrainedBox(
        constraints: BoxConstraints(
          maxWidth: constraints.maxWidth * Metrics.bubbleMaxFraction,
        ),
        child: child,
      ),
    );
  }
}

/// The rounded rectangle and its little tail. Drawn as a stack rather than a custom painter so the
/// tail is the same colour by construction — the React one had the same shape for the same reason.
class _BubbleBody extends StatelessWidget {
  const _BubbleBody({
    required this.text,
    required this.mine,
    required this.background,
    required this.foreground,
  });

  final String text;
  final bool mine;
  final Color background;
  final Color foreground;

  @override
  Widget build(BuildContext context) {
    return Stack(
      clipBehavior: Clip.none,
      children: [
        Positioned(
          top: 12,
          left: mine ? null : -3,
          right: mine ? -3 : null,
          child: Transform.rotate(
            angle: math.pi / 4,
            child: Container(width: 8, height: 8, color: background),
          ),
        ),
        Container(
          padding: Metrics.bubblePadding,
          decoration: BoxDecoration(
            color: background,
            borderRadius: BorderRadius.circular(Metrics.bubbleRadius),
          ),
          child: Text(
            text,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
              color: foreground,
              fontSize: Metrics.bubbleTextSize,
              height: 1.35,
            ),
          ),
        ),
      ],
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
    final labels = Theme.of(context).textTheme.labelSmall;
    return Padding(
      padding: const EdgeInsets.fromLTRB(10, 3, 10, 3),
      child: Row(
        textDirection: TextDirection.rtl,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Where the avatar would be, so a message on its way does not jump sideways once it
          // lands and grows one.
          const SizedBox(width: 36, height: 36),
          const SizedBox(width: 8),
          Flexible(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                _BubbleWidth(
                  child: Opacity(
                    opacity: pending.isStuck ? 1 : 0.6,
                    child: _BubbleBody(
                      text: pending.content,
                      mine: true,
                      background: ownBubble,
                      foreground: ownBubbleInk,
                    ),
                  ),
                ),
                const SizedBox(height: 2),
                if (!pending.isStuck)
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        Icons.schedule,
                        size: 11,
                        color: scheme.onSurfaceVariant,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        'sending…',
                        style: labels?.copyWith(
                          color: scheme.onSurfaceVariant,
                          fontSize: 11,
                        ),
                      ),
                    ],
                  )
                else
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        pending.lastError == null
                            ? 'not sent'
                            : 'not sent: ${pending.lastError}',
                        style: labels?.copyWith(color: scheme.error),
                      ),
                      const SizedBox(width: 8),
                      _InlineAction(label: 'retry', onTap: onRetry),
                      const SizedBox(width: 8),
                      _InlineAction(label: 'remove', onTap: onDiscard),
                    ],
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// The underlined word the React client used here. A full button would out-shout the message it
/// is attached to.
class _InlineAction extends StatelessWidget {
  const _InlineAction({required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Text(
        label,
        style: Theme.of(context).textTheme.labelSmall?.copyWith(
          color: Theme.of(context).colorScheme.error,
          decoration: TextDecoration.underline,
          decorationColor: Theme.of(context).colorScheme.error,
        ),
      ),
    );
  }
}

class _Composer extends StatelessWidget {
  const _Composer({required this.controller, required this.onSend});

  final TextEditingController controller;
  final VoidCallback onSend;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLow,
        border: Border(top: BorderSide(color: scheme.outlineVariant)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: _ReadingColumn(
            // The row is as tall as the field, and the button is stretched to it. Matching heights
            // by writing the same number in two places did not hold: what you see of the field is
            // the box its DECORATION paints, and Material reserves a little more around a button
            // than around a border, so the two ended up agreeing in the widget tree and disagreeing
            // on screen. Measuring one against the other removes the question.
            child: IntrinsicHeight(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Expanded(
                    child: TextField(
                      controller: controller,
                      minLines: 1,
                      maxLines: 6,
                      textInputAction: TextInputAction.newline,
                      style: Theme.of(
                        context,
                      ).textTheme.bodyMedium?.copyWith(fontSize: 14),
                      // The padding is spelled out here rather than left to the theme, and the field
                      // is not wrapped in a minimum height. Both of those were how it ended up 48
                      // tall next to a 40 tall button: the box was told its floor while the field
                      // inside it kept Material's own idea of comfortable padding, and the eight
                      // pixels of difference sat above the text where nothing explained them.
                      // One line of text at 14 with 10 above and below IS the button's height.
                      decoration: const InputDecoration(
                        hintText: 'message…',
                        isDense: true,
                        contentPadding: EdgeInsets.symmetric(
                          horizontal: 12,
                          vertical: 10,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  FilledButton(
                    onPressed: onSend,
                    style: FilledButton.styleFrom(
                      // WeChat's green, not the brand green — the React composer's own choice.
                      backgroundColor: sendGreen,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(horizontal: 20),
                      // Material inflates a button to a 48px touch target by default, and it is
                      // the row that decides the height here. The composer row is already
                      // comfortably tappable.
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      minimumSize: Size.zero,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(4),
                      ),
                    ),
                    child: const Text('send'),
                  ),
                ],
              ),
            ),
          ),
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

/// A conversation does not run the full width of a wide window.
///
/// The React desktop shell put the messages and the composer in one centred 768px column, and a
/// bubble capped at 72% of THAT rather than of the window — which is why a message never became a
/// single 1200px line. On a phone the column is simply the screen.
class _ReadingColumn extends StatelessWidget {
  const _ReadingColumn({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: Metrics.readingColumn),
        child: child,
      ),
    );
  }
}
