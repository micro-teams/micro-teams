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
import '../common/mt_client.dart';
import '../common/updates/topics.dart';

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

    final cache = ref.watch(cacheProvider);
    final response = await mtCall(
      ref.read(mtClientProvider).chat.listChats(pageSize: 50),
    );
    final chats = response.data?.chats ?? const <ChatSummary>[];
    cache.set<List<Object?>>('chats', chats.map((c) => c.toJson()).toList());
    return chats;
  }

  /// What to paint before the first answer arrives. Read synchronously so the list is on screen in
  /// the same frame as the rest of the app.
  List<ChatSummary> cached() {
    final raw = ref.read(cacheProvider).get<List<Object?>>('chats');
    if (raw == null) return const [];
    return raw
        .whereType<Map<String, Object?>>()
        .map(ChatSummary.fromJson)
        .toList();
  }
}

final chatsProvider = AsyncNotifierProvider<ChatsController, List<ChatSummary>>(
  ChatsController.new,
);
