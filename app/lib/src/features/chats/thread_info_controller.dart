/// Who is in a conversation, and what it is called.
///
/// Separate from [threadProvider] on purpose: messages arrive constantly and members almost never
/// change, so putting them in one provider would refetch the roster on every incoming message —
/// and, worse, make a failure to load members able to blank a conversation that is otherwise fine.
///
/// The screen needs this for three things the old client had and the first Flutter cut did not: a
/// real title in the app bar instead of the word "Conversation", an avatar beside every bubble,
/// and the sender's name above other people's messages.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mt_api/mt_api.dart';

import '../../app_providers.dart';
import '../../mt/client.dart';

class ThreadInfo {
  const ThreadInfo({this.title = '', this.members = const {}});

  /// The thread's own title. Empty when it has none — a direct chat is named after the other
  /// person, which only the caller (who knows who "me" is) can work out.
  final String title;

  /// Members by user id.
  final Map<int, ThreadMember> members;

  ThreadMember? member(int userId) => members[userId];

  /// What to call [userId]. Falls back to the same `user #id` the React client used, so an
  /// unknown sender reads as an unknown sender rather than as a blank.
  String nameOf(int userId) => members[userId]?.nickname ?? 'user #$userId';

  int? avatarOf(int userId) => members[userId]?.avatarId;

  /// The people who are not [me]. What a chat is *called* depends on this.
  List<ThreadMember> others(int? me) =>
      members.values.where((m) => m.userId != me).toList();
}

class ThreadInfoController extends FamilyAsyncNotifier<ThreadInfo, int> {
  @override
  Future<ThreadInfo> build(int arg) async {
    final response = await mtCall(
      ref.watch(mtClientProvider).chat.getThread(id: arg),
    );
    final detail = response.data;
    return ThreadInfo(
      title: detail?.thread.title ?? '',
      members: {
        for (final member in detail?.members ?? const <ThreadMember>[])
          member.userId: member,
      },
    );
  }
}

final threadInfoProvider =
    AsyncNotifierProvider.family<ThreadInfoController, ThreadInfo, int>(
      ThreadInfoController.new,
    );
