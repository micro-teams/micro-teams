/// The chat list as one person sees it: which conversations, in what order, with which last
/// message.
///
/// One subscription declaration and one fetch. That is the whole feature — which is the bar the
/// sync layer was built to meet, and the number to check the next time someone asks whether the
/// rewrite paid for itself.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mt_api/mt_api.dart';

import '../providers.dart';
import '../common/updates/topics.dart';

/// How many conversations one page holds, and the request that asks for them.
///
/// The path is written out because the cache is keyed by the REQUEST, which is what stops two
/// screens inventing two names for the same data — the cost is that a caller wanting yesterday's
/// answer has to name the question. `cached_reads_test.dart` makes the real call against a fake and
/// then reads it back, so this constant cannot drift from what the generated client actually sends.
const int chatsPageSize = 50;

/// Including `queryIsMemberAgent`, which the generated client sends whether or not a caller
/// mentions it. Leaving it out looked right and cached under a request that is never made — the
/// cache simply never hit, which is invisible because a cache that misses looks like one that is
/// not needed. `cached_reads_test.dart` is what found it and what keeps it honest.
const String chatsPath =
    '/mt/chat?page_size=$chatsPageSize&queryIsMemberAgent=false';

class ChatsController extends AsyncNotifier<List<ChatSummary>> {
  @override
  Future<List<ChatSummary>> build() async {
    final session = ref.watch(sessionProvider).value;
    if (session == null) return const [];

    watchTopic(
      ref,
      chatsTopic(session.user.id),
      onChange: (_) => ref.invalidateSelf(),
      // Mirrors ChatsQuery.digest exactly: the NUMBER of conversations and nothing else.
      //
      // It is deliberately that weak on both sides. The list the client holds carries no message
      // id — only the last message's text and time — and digesting a timestamp would mean two
      // independent renderings of the same instant having to agree forever, which is precisely the
      // quiet disagreement this mechanism exists to catch rather than cause. Anything richer here
      // would not be a better check; it would be a check that fires constantly and means nothing.
      digest: () {
        final threads = state.value;
        return threads == null ? null : '${threads.length}';
      },
    );

    final response = await ref
        .read(mtClientProvider)
        .chat
        .listChats(pageSize: chatsPageSize);
    // Nothing is stored here: the client records every successful GET under the request's own key,
    // so what this call just fetched is already what [cached] finds next time.
    return response.data?.chats ?? const <ChatSummary>[];
  }

  /// What to paint before the first answer arrives. Read synchronously so the list is on screen in
  /// the same frame as the rest of the app.
  List<ChatSummary> cached() {
    final raw = ref
        .read(mtClientProvider)
        .cached<Map<String, Object?>>('GET', chatsPath);
    final chats = raw?['chats'];
    if (chats is! List) return const [];
    return chats
        .whereType<Map<String, Object?>>()
        .map(ChatSummary.fromJson)
        .toList();
  }
}

final chatsProvider = AsyncNotifierProvider<ChatsController, List<ChatSummary>>(
  ChatsController.new,
);
