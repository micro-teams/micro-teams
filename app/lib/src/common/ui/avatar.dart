/// The one avatar control, ported from the React `Avatar.tsx`.
///
/// Rounded squares, WeChat style — not circles. When the caller knows an `avatarId` the real
/// picture comes from cheese-auth through the same `/api/avatars/:id` proxy the old client used;
/// when it does not, or the image fails, the fallback is a deterministic colour and an initial.
/// The colour list and the `abs(seed) % length` rule are copied exactly, so the same person keeps
/// the same colour across the two clients and across devices.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers.dart';
import 'theme.dart';

const List<Color> _palette = [
  Color(0xFF4E6EF2),
  Color(0xFF12B76A),
  Color(0xFFF79009),
  Color(0xFFEF4444),
  Color(0xFF7C3AED),
  Color(0xFF06AED4),
  Color(0xFFE64980),
  Color(0xFF2DD4BF),
];

Color colourFor(int seed) => _palette[seed.abs() % _palette.length];

class UserAvatar extends ConsumerWidget {
  const UserAvatar({
    required this.userId,
    this.nickname,
    this.avatarId,
    this.size = Metrics.avatarInBubble,
    this.isAgent = false,
    this.onTap,
    super.key,
  });

  final int userId;
  final String? nickname;

  /// cheese-auth's id for the picture. Absent for anyone whose row we have not been given — the
  /// initial is not a placeholder for a slow image, it is the answer.
  final int? avatarId;

  final double size;

  /// Draws the small robot badge the React avatar had. Being an agent is worth saying even when
  /// there is nothing to watch — otherwise a conversation gives no sign of who you are talking to.
  final bool isAgent;

  /// What tapping does. Only agents ever have one: it opens their live screen.
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // One radius at every size — the React `Avatar` had one `rounded-lg` and so does this.
    final radius = BorderRadius.circular(Metrics.avatarRadius);
    final label = (nickname ?? '$userId').trim();
    final initial = label.isEmpty ? '#' : label.characters.first.toUpperCase();

    final fallback = Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(color: colourFor(userId), borderRadius: radius),
      child: Text(
        initial,
        style: TextStyle(
          color: Colors.white,
          fontSize: size * 0.4,
          fontWeight: FontWeight.w600,
        ),
      ),
    );

    final id = avatarId;
    final Widget picture;
    if (id == null || id == 0) {
      picture = fallback;
    } else {
      final url = '${ref.watch(endpointsProvider).auth}/avatars/$id';
      picture = ClipRRect(
        borderRadius: radius,
        child: Image.network(
          url,
          width: size,
          height: size,
          fit: BoxFit.cover,
          // The initial, not a spinner or a hole: an avatar that flickers grey on every rebuild is
          // more distracting than one that is briefly the wrong shape.
          loadingBuilder: (context, child, progress) =>
              progress == null ? child : fallback,
          errorBuilder: (context, error, stack) => fallback,
        ),
      );
    }

    Widget result = picture;
    if (isAgent) {
      result = Stack(
        clipBehavior: Clip.none,
        children: [
          picture,
          Positioned(
            right: -3,
            bottom: -3,
            child: Container(
              padding: const EdgeInsets.all(1.5),
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.surface,
                shape: BoxShape.circle,
              ),
              child: Icon(Icons.smart_toy, size: size * 0.3, color: brandGreen),
            ),
          ),
        ],
      );
    }
    if (onTap == null) return result;
    return MouseRegion(
      cursor: SystemMouseCursors.click,
      child: GestureDetector(onTap: onTap, child: result),
    );
  }
}

/// A group's avatar: up to four members in a grid, the way WeChat draws one.
class MemberGridAvatar extends StatelessWidget {
  const MemberGridAvatar({
    required this.members,
    this.size = Metrics.avatarInList,
    super.key,
  });

  /// (userId, nickname, avatarId) for as many members as the caller has.
  final List<({int userId, String nickname, int? avatarId})> members;
  final double size;

  @override
  Widget build(BuildContext context) {
    final shown = members.take(4).toList();
    if (shown.length == 1) {
      return UserAvatar(
        userId: shown.first.userId,
        nickname: shown.first.nickname,
        avatarId: shown.first.avatarId,
        size: size,
      );
    }
    const gap = 2.0;
    final cell = (size - gap) / 2;
    return SizedBox(
      width: size,
      height: size,
      child: Wrap(
        spacing: gap,
        runSpacing: gap,
        children: [
          for (final m in shown)
            UserAvatar(
              userId: m.userId,
              nickname: m.nickname,
              avatarId: m.avatarId,
              size: cell,
            ),
        ],
      ),
    );
  }
}
