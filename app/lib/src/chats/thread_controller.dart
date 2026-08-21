/// One open conversation: the messages, how they arrive, and how history is walked backwards.
///
/// Everything about *where the list sits* is deliberately NOT here, and that is the one real
/// difference from the React version. There, the hook owned a scroll element, a pin-to-bottom
/// rule and a scroll-position restore, because a browser list grows downward and inserting above
/// the viewport throws the reader somewhere else. Here the list is drawn reversed — newest at the
/// bottom, index 0 at the end — so "load older" is simply "reached the end of the list", and the
/// anchor problem does not exist to be got wrong.
///
/// That matters beyond tidiness: scroll-up pagination is the one thing in this app that has been
/// reported broken, fixed, and reported broken again (T-073). Moving it from a rule that must be
/// maintained to a shape that cannot misbehave is the point.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mt_api/mt_api.dart';

import '../providers.dart';
import '../common/errors.dart';
import '../common/mt_client.dart';
import '../common/updates/topics.dart';
import 'merge.dart';
import 'outbox.dart';

/// Messages per request — the newest page, and each older page walked backwards.
const int pageSize = 100;

class ThreadState {
  const ThreadState({
    this.messages = const [],
    this.pending = const [],
    this.loadingOlder = false,
    this.hasOlder = false,
    this.error,
  });

  final List<Message> messages;
  final List<Pending> pending;
  final bool loadingOlder;

  /// Whether the server says there is more history behind what we hold. The UI shows this as a
  /// visible state at the top of the list — "loading earlier messages" or "that is the beginning"
  /// — because a reader who scrolls up and sees nothing at all cannot tell a working feature from
  /// a broken one. That ambiguity is precisely what made T-073 so hard to pin down.
  final bool hasOlder;

  final String? error;

  ThreadState copyWith({
    List<Message>? messages,
    List<Pending>? pending,
    bool? loadingOlder,
    bool? hasOlder,
    String? error,
    bool clearError = false,
  }) => ThreadState(
    messages: messages ?? this.messages,
    pending: pending ?? this.pending,
    loadingOlder: loadingOlder ?? this.loadingOlder,
    hasOlder: hasOlder ?? this.hasOlder,
    error: clearError ? null : (error ?? this.error),
  );
}

class ThreadController extends FamilyAsyncNotifier<ThreadState, int> {
  late final int _threadId;
  Outbox? _outbox;

  /// Cursor for the next OLDER page, and whether one exists. While no older page has been loaded
  /// these track the newest page (its nextStart moves as new messages arrive); after the first
  /// walk backwards they only ever advance backwards.
  int? _olderCursor;
  bool _walkedBack = false;

  @override
  Future<ThreadState> build(int arg) async {
    _threadId = arg;
    final cache = ref.watch(cacheProvider);
    final client = ref.watch(mtClientProvider);

    _outbox = Outbox(
      threadId: _threadId,
      client: client,
      cache: cache,
      onSent: _adoptSent,
      onChanged: _publishPending,
    );
    ref.onDispose(() => _outbox?.dispose());

    // The sync layer says when this thread moved and, periodically, what it should look like. The
    // digest mirrors ThreadQuery.digest on the backend over the same window — the only reason the
    // two are comparable at all.
    watchTopic(
      ref,
      threadTopic(_threadId),
      onChange: (_) => refresh(),
      digest: () => threadDigest(
        state.value?.messages ?? const [],
        loading: state.isLoading,
        window: pageSize,
      ),
    );

    // Paint what we already have at once, then revalidate. On a phone this is most of the
    // experience: the app was killed, and a spinner where a conversation used to be reads as
    // data loss.
    final cached = cache.get<List<Object?>>('messages:$_threadId');
    final seeded = cached == null
        ? const <Message>[]
        : cached
              .whereType<Map<String, Object?>>()
              .map(Message.fromJson)
              .toList();

    final fetched = await _fetchNewest(seeded);
    return fetched;
  }

  /// [knownHasOlder] is passed in rather than read from `state`, because this runs during build
  /// too — and reading `state` before the first value exists throws. A ternary that only avoids
  /// that by short-circuiting is a trap for the next person.
  Future<ThreadState> _fetchNewest(
    List<Message> held, {
    bool knownHasOlder = false,
  }) async {
    final client = ref.read(mtClientProvider);
    final response = await mtCall(
      client.chat.listMessages(id: _threadId, pageSize: pageSize),
    );
    final body = response.data;
    final page = body?.messages ?? const <Message>[];

    _outbox?.reconcile(page);
    if (!_walkedBack) {
      _olderCursor = body?.page.nextStart;
    }

    final merged = mergeNewestPage(held, page);
    _cacheNewest(merged);
    return ThreadState(
      messages: merged,
      pending: _outbox?.pending ?? const [],
      hasOlder: _walkedBack ? knownHasOlder : (body?.page.hasMore ?? false),
    );
  }

  /// Refetch the newest page. Called by the sync layer, and by a pull-to-refresh.
  Future<void> refresh() async {
    final current = state.value;
    try {
      final next = await _fetchNewest(
        current?.messages ?? const <Message>[],
        knownHasOlder: current?.hasOlder ?? false,
      );
      state = AsyncValue.data(next);
    } catch (e) {
      // Deliberately every error, not just MtError: this is called from the sync layer's callback,
      // where nothing is awaiting it, so anything that escapes becomes an unhandled async error
      // that kills the zone instead of one conversation's refresh.
      //
      // Keep showing what we hold. A failed refresh is not a reason to blank a conversation.
      if (current == null) {
        state = AsyncValue.error(e, StackTrace.current);
      } else {
        state = AsyncValue.data(
          current.copyWith(error: e is MtError ? e.message : '$e'),
        );
      }
    }
  }

  /// Walk one page further back. Safe to call repeatedly: it is a no-op while one is in flight or
  /// once the server has said there is nothing older.
  Future<void> loadOlder() async {
    final current = state.value;
    if (current == null || current.loadingOlder || !current.hasOlder) return;
    final cursor = _olderCursor;
    if (cursor == null) return;

    state = AsyncValue.data(
      current.copyWith(loadingOlder: true, clearError: true),
    );
    try {
      final response = await mtCall(
        ref
            .read(mtClientProvider)
            .chat
            .listMessages(id: _threadId, pageStart: cursor, pageSize: pageSize),
      );
      final body = response.data;
      _walkedBack = true;
      _olderCursor = body?.page.nextStart;
      final merged = mergeOlderPage(
        state.value?.messages ?? current.messages,
        body?.messages ?? const [],
      );
      state = AsyncValue.data(
        (state.value ?? current).copyWith(
          messages: merged,
          loadingOlder: false,
          hasOlder: body?.page.hasMore ?? false,
        ),
      );
    } on MtError catch (e) {
      state = AsyncValue.data(
        (state.value ?? current).copyWith(
          loadingOlder: false,
          error: e.message,
        ),
      );
    }
  }

  /// Hand a message to the outbox, which owns delivery from here.
  void send(String content) => _outbox?.enqueue(content);

  void retry(String clientToken) => _outbox?.retry(clientToken);

  /// Returns the text so the composer can take it back.
  String? discard(String clientToken) => _outbox?.discard(clientToken);

  void _adoptSent(Message message) {
    final current = state.value;
    if (current == null) return;
    if (current.messages.any((m) => m.id == message.id)) return;
    final merged = [...current.messages, message];
    _cacheNewest(merged);
    state = AsyncValue.data(
      current.copyWith(messages: merged, pending: _outbox?.pending ?? const []),
    );
  }

  void _publishPending() {
    final current = state.value;
    if (current == null) return;
    state = AsyncValue.data(
      current.copyWith(pending: _outbox?.pending ?? const []),
    );
  }

  /// Only the newest page is cached. History someone scrolled up to read is cheap to fetch again
  /// and expensive to store on a phone.
  void _cacheNewest(List<Message> merged) {
    final tail = merged.length <= pageSize
        ? merged
        : merged.sublist(merged.length - pageSize);
    ref
        .read(cacheProvider)
        .set<List<Object?>>(
          'messages:$_threadId',
          tail.map((m) => m.toJson()).toList(),
        );
  }
}

final threadProvider =
    AsyncNotifierProvider.family<ThreadController, ThreadState, int>(
      ThreadController.new,
    );
