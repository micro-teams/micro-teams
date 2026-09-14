/// The one avatar control, ported from React's `Avatar.tsx` and `UserAvatar.tsx`.
///
/// Rounded squares, WeChat style — not circles. With an `avatarId` the real picture comes from
/// cheese-auth; without one, or when the image fails, the fallback is a deterministic colour and an
/// initial. The colour list and the `abs(seed) % length` rule are copied exactly, so the same
/// person keeps the same colour across the two clients and across devices.
///
/// Everything else here is what made an avatar in the old client more than a picture. Every avatar
/// registers its user id with the app-global presence registry, and what comes back decides:
///
///   * whether this is an agent at all — only agents are enumerated, so being in the answer is the
///     answer;
///   * whether it is working (busy / starting / compacting), which draws the pulsing ring;
///     what an agent is spending;
///   * whether tapping it opens that agent's live screen.
///
/// An agent is ALWAYS tappable, even when there is nothing to open: a tap that explains itself
/// ("offline", "no live screen") is better than a dead avatar, and no action should fail silently.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../presence_controller.dart';
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

/// The ring and the meta pill are this violet in the React client, in both themes, and it is not
/// the brand green on purpose: it means "this one is working", not "this is us".
const Color workingViolet = Color(0xFF7C3AED);

class UserAvatar extends ConsumerStatefulWidget {
  const UserAvatar({
    required this.userId,
    this.nickname,
    this.avatarId,
    this.size = Metrics.avatarInBubble,
    this.clickable = true,
    super.key,
  });

  final int userId;
  final String? nickname;

  /// cheese-auth's id for the picture. Absent for anyone whose row we have not been given — the
  /// initial is not a placeholder for a slow image, it is the answer.
  final int? avatarId;

  final double size;

  /// Whether tapping an agent opens its live screen. False inside a group tile, where the tap
  /// belongs to the row.
  final bool clickable;

  @override
  ConsumerState<UserAvatar> createState() => _UserAvatarState();
}

class _UserAvatarState extends ConsumerState<UserAvatar>
    with SingleTickerProviderStateMixin {
  late final AnimationController _pulse = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1600),
  )..repeat(reverse: true);

  /// 0.35 → 1 opacity and 1 → 1.08 scale, out and back. The same curve as the React keyframes,
  /// which is what makes it read as the same app; `reverse: true` on the controller is what makes
  /// the "and back" free rather than arithmetic done on every tick.
  late final Animation<double> _ring = Tween<double>(
    begin: 0.35,
    end: 1,
  ).animate(_pulse);

  late final Animation<double> _ringScale = Tween<double>(
    begin: 1,
    end: 1.08,
  ).animate(_pulse);

  /// Held rather than read on demand, and taken eagerly in initState: `ref` is unusable once the
  /// widget is disposed, and untrack has to happen exactly then — an avatar that scrolled away must
  /// stop being asked about. A `late` field would be evaluated at that first use, which is the one
  /// moment it cannot be.
  late AgentPresence _registry;

  @override
  void initState() {
    super.initState();
    _registry = ref.read(agentPresenceProvider.notifier);
    // After the frame, because tracking makes a provider change while this one is building.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _registry.track(widget.userId);
    });
  }

  @override
  void didUpdateWidget(UserAvatar old) {
    super.didUpdateWidget(old);
    if (old.userId != widget.userId) {
      _registry.untrack(old.userId);
      _registry.track(widget.userId);
    }
  }

  /// Run the ring's animation only while there is a ring.
  ///
  /// The controller is `late final`, so an avatar that has never been working never creates one —
  /// that part was always right. What was missing is the other edge: an agent that STOPS working
  /// left the controller running for the life of the widget, and a live Ticker keeps the engine
  /// producing frames at the display's rate with nothing new to paint. On a chat list where one
  /// agent worked once, that is every frame, forever.
  ///
  /// Nothing about what is on screen changes: the ring is not built when [working] is false, so
  /// stopping the thing that drives it is invisible.
  void _pulseWhile(bool working) {
    if (working) {
      if (!_started || !_pulse.isAnimating) {
        _started = true;
        _pulse.repeat(reverse: true);
      }
    } else if (_started && _pulse.isAnimating) {
      _pulse.stop();
    }
  }

  /// Whether the controller has ever been reached for. Asking `_pulse.isAnimating` on its own would
  /// CREATE it, which is the cost this is here to avoid.
  bool _started = false;

  @override
  void dispose() {
    if (_started) _pulse.dispose();
    _registry.untrack(widget.userId);
    super.dispose();
  }

  void _open(BuildContext context, {required bool online, String? sid}) {
    final name = widget.nickname?.isNotEmpty == true
        ? widget.nickname!
        : '#${widget.userId}';
    if (sid != null && sid.isNotEmpty && online) {
      askForScene(context, sid: sid, nickname: name);
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(online ? '「$name」的现场暂不可用' : '「$name」当前离线，无法查看现场')),
    );
  }

  @override
  Widget build(BuildContext context) {
    final presence = ref.watch(agentPresenceProvider);
    final agent = presence[widget.userId];
    final isAgent = agent != null;
    final working = isWorking(agent);
    _pulseWhile(working);
    final avatarId = widget.avatarId ?? agent?.avatarId;
    final name = (widget.nickname ?? agent?.nickname ?? '${widget.userId}')
        .trim();

    final picture = _Picture(
      userId: widget.userId,
      label: name,
      avatarId: avatarId,
      size: widget.size,
    );

    Widget result = picture;

    if (working) {
      // The React ring is a circle at inset -18%: our avatars are rounded squares, whose corners
      // reach further from the centre than a flat inset would clear, so the inset is proportional
      // to the size at every size the app uses.
      final inset = widget.size * 0.18;
      result = SizedBox(
        width: widget.size,
        height: widget.size,
        child: Stack(
          clipBehavior: Clip.none,
          alignment: Alignment.center,
          children: [
            Positioned(
              left: -inset,
              top: -inset,
              right: -inset,
              bottom: -inset,
              // Keyed because it is the only thing that says an agent is working, and a pulsing
              // circle drawn on a canvas is otherwise invisible to a test.
              key: const ValueKey('working-ring'),
              // FadeTransition and ScaleTransition rather than an AnimatedBuilder that rebuilds
              // this subtree sixty times a second: they drive the render objects directly, so a
              // pulsing ring costs no widget building at all. Flutter's own performance guidance
              // says exactly this about Opacity in an animation, and there is one of these per
              // working agent on screen.
              child: FadeTransition(
                opacity: _ring,
                child: ScaleTransition(
                  scale: _ringScale,
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      border: Border.all(color: workingViolet, width: 2),
                    ),
                  ),
                ),
              ),
            ),
            picture,
          ],
        ),
      );
    }

    if (!(widget.clickable && isAgent)) return result;

    return MouseRegion(
      cursor: SystemMouseCursors.click,
      child: GestureDetector(
        onTap: () => _open(context, online: agent.online, sid: agent.sid),
        child: Tooltip(
          message: presence.watchable(widget.userId)
              ? '$name · 点击查看现场'
              : agent.online
              ? '$name · 现场暂不可用'
              : '$name · 离线',
          child: result,
        ),
      ),
    );
  }
}

/// What the whole app does when an avatar asks for a live screen.
///
/// Set once, at the top, because an avatar has no business knowing how this app shows a terminal —
/// but every avatar everywhere has to be able to ask.
void Function(BuildContext context, {required String sid, String? nickname})?
openSceneHandler;

void askForScene(
  BuildContext context, {
  required String sid,
  String? nickname,
}) => openSceneHandler?.call(context, sid: sid, nickname: nickname);

/// The picture itself: the real image, or a colour and an initial.
class _Picture extends ConsumerWidget {
  const _Picture({
    required this.userId,
    required this.label,
    required this.avatarId,
    required this.size,
  });

  final int userId;
  final String label;
  final int? avatarId;
  final double size;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final radius = BorderRadius.circular(Metrics.avatarRadius);
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
    if (id == null || id == 0) return fallback;

    return ClipRRect(
      borderRadius: radius,
      // hardEdge, not the default antiAlias: an antialiased clip is a saveLayer, and there is one
      // of these per row of every list in the app. The corner is 8px on a 44px square — nobody has
      // ever seen the difference, and Flutter's guidance is to spend clips carefully.
      clipBehavior: Clip.hardEdge,
      child: Image.network(
        '${ref.watch(endpointsProvider).auth}/avatars/$id',
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
}

/// A group's avatar: WeChat's grid, up to nine faces in one rounded tile.
///
/// The part that makes it read as WeChat is that a row which is not full is CENTRED rather than
/// left-aligned: three members are one-over-two, five are two-over-three. Tiles are half the square
/// up to four members and a third beyond. Copied row for row from the React `MemberGrid`.
class MemberGridAvatar extends StatelessWidget {
  const MemberGridAvatar({
    required this.members,
    this.size = Metrics.avatarInList,
    super.key,
  });

  /// (userId, nickname, avatarId) for as many members as the caller has.
  final List<({int userId, String nickname, int? avatarId})> members;
  final double size;

  /// How many tiles go on each row, for a group of [n].
  static List<int> rowsFor(int n) => switch (n) {
    <= 1 => const [1],
    2 => const [2],
    3 => const [1, 2],
    4 => const [2, 2],
    5 => const [2, 3],
    6 => const [3, 3],
    7 => const [1, 3, 3],
    8 => const [2, 3, 3],
    _ => const [3, 3, 3],
  };

  @override
  Widget build(BuildContext context) {
    final shown = members.take(9).toList();
    if (shown.length == 1) {
      return UserAvatar(
        userId: shown.first.userId,
        nickname: shown.first.nickname,
        avatarId: shown.first.avatarId,
        size: size,
      );
    }

    // The React tile is `(100% - (perRow-1)px) / perRow` of the ROW's width, and the row sits
    // inside a 1px padding — so the arithmetic is over `size - 2*gap`, not over `size`.
    const gap = 1.0;
    final perRow = shown.length <= 4 ? 2 : 3;
    final tile = (size - 2 * gap - gap * (perRow - 1)) / perRow;
    var i = 0;

    return Container(
      width: size,
      height: size,
      padding: const EdgeInsets.all(gap),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(Metrics.avatarRadius),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          for (final (r, count) in rowsFor(shown.length).indexed)
            Padding(
              // Between rows only: a gap under the last one is a row that does not fit.
              padding: EdgeInsets.only(top: r == 0 ? 0 : gap),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  for (var c = 0; c < count; c++) ...[
                    if (c > 0) const SizedBox(width: gap),
                    () {
                      final member = shown[i++];
                      return UserAvatar(
                        userId: member.userId,
                        nickname: member.nickname,
                        avatarId: member.avatarId,
                        size: tile,
                        // The tap belongs to the row this tile is in.
                        clickable: false,
                      );
                    }(),
                  ],
                ],
              ),
            ),
        ],
      ),
    );
  }
}
