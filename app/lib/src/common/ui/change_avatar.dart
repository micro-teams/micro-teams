/// An avatar you can change.
///
/// Two targets, one control: the signed-in human, and an agent. The upload half is identical for
/// both — the picture goes to cheese-auth as the human, which is the only identity a browser has.
/// Only APPLYING the resulting id differs, and it differs for a reason worth stating: cheese-auth
/// lets a user write only their OWN profile, so an agent's avatar cannot be set with a human's
/// token. mt has an endpoint that performs that change as the agent (PUT /agent/{userId}/avatar).
///
/// [UserAvatar] stays purely presentational. It is read-only in dozens of places, and upload logic
/// has no business in a display primitive; this is the editing shell that wraps it.
library;

import 'package:file_selector/file_selector.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers.dart';
import 'avatar.dart';

/// Whose avatar this changes.
sealed class AvatarTarget {
  const AvatarTarget();
}

class MyAvatar extends AvatarTarget {
  const MyAvatar();
}

/// Somebody else's avatar, with the way to apply a new one supplied by whoever owns them.
///
/// The apply step is a callback rather than a call from here on purpose: cheese-auth lets a user
/// write only their own profile, so pointing an agent's profile at an id is mt's business and the
/// agents feature's to express. common/ knowing what an agent is would make every other feature
/// depend on agents through this file.
class OtherAvatar extends AvatarTarget {
  const OtherAvatar({
    required this.userId,
    required this.nickname,
    required this.avatarId,
    required this.apply,
  });

  final int userId;
  final String nickname;
  final int? avatarId;
  final Future<void> Function(int avatarId) apply;
}

class ChangeAvatar extends ConsumerStatefulWidget {
  const ChangeAvatar({
    this.target = const MyAvatar(),
    this.size = 80,
    this.onChanged,
    super.key,
  });

  final AvatarTarget target;
  final double size;

  /// Called after a successful change, so a list around this can refetch.
  final VoidCallback? onChanged;

  @override
  ConsumerState<ChangeAvatar> createState() => _ChangeAvatarState();
}

class _ChangeAvatarState extends ConsumerState<ChangeAvatar> {
  bool _busy = false;

  /// Shown at once, before whatever list we are inside gets round to refetching.
  int? _justSet;

  Future<void> _pick() async {
    final session = ref.read(sessionProvider).value;
    if (session == null || _busy) return;

    // Typed so the picker itself filters: a file dialog that lets you choose a PDF and then says
    // no is a dialog that wasted the choice.
    const images = XTypeGroup(
      label: 'images',
      extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'],
      mimeTypes: ['image/*'],
    );
    final file = await openFile(acceptedTypeGroups: const [images]);
    if (file == null) return;

    setState(() => _busy = true);
    try {
      final bytes = await file.readAsBytes();
      final avatarId = await ref
          .read(authApiProvider)
          .uploadAvatar(
            bytes: bytes,
            filename: file.name,
            accessToken: session.accessToken,
          );

      switch (widget.target) {
        case MyAvatar():
          // The whole profile, or the rest of it is blanked — see AuthApi.updateProfile.
          await ref
              .read(authApiProvider)
              .updateProfile(
                userId: session.user.id,
                nickname: session.user.nickname,
                intro: session.user.intro,
                avatarId: avatarId,
                accessToken: session.accessToken,
              );
          await ref.read(sessionProvider.notifier).refreshMe();
        case OtherAvatar(apply: final apply):
          await apply(avatarId);
      }

      if (!mounted) return;
      setState(() {
        _justSet = avatarId;
        _busy = false;
      });
      widget.onChanged?.call();
    } catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(sessionProvider).value;
    final scheme = Theme.of(context).colorScheme;

    final (userId, nickname, avatarId) = switch (widget.target) {
      MyAvatar() => (
        session?.user.id ?? 0,
        session?.user.nickname ?? '',
        session?.user.avatarId,
      ),
      OtherAvatar(
        userId: final id,
        nickname: final name,
        avatarId: final avatar,
      ) =>
        (id, name, avatar),
    };

    return Semantics(
      button: true,
      label: 'Change avatar',
      child: GestureDetector(
        onTap: _pick,
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            UserAvatar(
              userId: userId,
              nickname: nickname,
              avatarId: _justSet ?? avatarId,
              size: widget.size,
            ),
            // Always visible rather than on hover: there is no hover on a phone, and an
            // affordance nobody can discover is not one.
            Positioned(
              right: -4,
              bottom: -4,
              child: Container(
                width: 26,
                height: 26,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: scheme.primary,
                  shape: BoxShape.circle,
                  border: Border.all(color: scheme.surface, width: 2),
                ),
                child: _busy
                    ? SizedBox(
                        width: 12,
                        height: 12,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: scheme.onPrimary,
                        ),
                      )
                    : Icon(
                        Icons.photo_camera,
                        size: 14,
                        color: scheme.onPrimary,
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
