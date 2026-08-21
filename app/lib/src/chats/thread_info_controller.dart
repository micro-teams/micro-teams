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

import '../providers.dart';
import 'chats_controller.dart';

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

  /// Members in the order they are shown: owners first, then admins, then the rest.
  List<ThreadMember> get ranked {
    final list = members.values.toList();
    list.sort((a, b) {
      final byRole = (_roleOrder[a.role] ?? 3).compareTo(
        _roleOrder[b.role] ?? 3,
      );
      return byRole != 0 ? byRole : a.userId.compareTo(b.userId);
    });
    return list;
  }

  /// Whether [me] may add and remove people here.
  bool canManage(int? me) {
    final role = me == null ? null : members[me]?.role.name;
    return role == 'OWNER' || role == 'ADMIN';
  }

  bool isOwner(int? me) => me != null && members[me]?.role.name == 'OWNER';
}

/// Owners first, then admins, then everyone else — the order the member grid is drawn in.
///
/// Keyed by the generated enum rather than by its name: a role that is renamed or removed in the
/// contract then fails to compile here, instead of silently sorting to the end.
const Map<ThreadMemberRoleEnum, int> _roleOrder = {
  ThreadMemberRoleEnum.OWNER: 0,
  ThreadMemberRoleEnum.ADMIN: 1,
  ThreadMemberRoleEnum.MEMBER: 2,
};

class ThreadInfoController extends FamilyAsyncNotifier<ThreadInfo, int> {
  @override
  Future<ThreadInfo> build(int arg) async {
    final response = await ref.watch(mtClientProvider).chat.getThread(id: arg);
    final detail = response.data;
    return ThreadInfo(
      title: detail?.thread.title ?? '',
      members: {
        for (final member in detail?.members ?? const <ThreadMember>[])
          member.userId: member,
      },
    );
  }

  /// Put someone in. Refetched rather than patched: a roster edited locally disagrees with the
  /// server the moment two people edit it, and the screen then lies until you leave it.
  Future<void> add(int userId) async {
    await ref
        .read(mtClientProvider)
        .chat
        .addThreadMember(
          id: arg,
          addMemberRequest: AddMemberRequest(userId: userId),
        );
    ref.invalidateSelf();
  }

  Future<void> remove(int userId) async {
    await ref
        .read(mtClientProvider)
        .chat
        .removeThreadMember(id: arg, userId: userId);
    ref.invalidateSelf();
  }

  Future<void> rename(String title) async {
    await ref
        .read(mtClientProvider)
        .chat
        .renameThread(
          id: arg,
          renameThreadRequest: RenameThreadRequest(title: title.trim()),
        );
    ref.invalidateSelf();
    ref.invalidate(chatsProvider);
  }

  /// Dissolve the conversation. It is gone for everyone, which is why every surface that offers
  /// this asks first.
  Future<void> dissolve() async {
    await ref.read(mtClientProvider).chat.dissolveThread(id: arg);
    ref.invalidate(chatsProvider);
  }
}

final threadInfoProvider =
    AsyncNotifierProvider.family<ThreadInfoController, ThreadInfo, int>(
      ThreadInfoController.new,
    );
