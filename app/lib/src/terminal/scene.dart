/// The one live screen, floating over whatever you were doing — as a frame on the display stack.
///
/// Watching an agent work is not a place you go: it is a thing you glance at, and underneath it
/// everything must stay exactly where you left it. That is why it is drawn over the app rather than
/// instead of it.
///
/// But "over the app" is not the same as "outside the stack", and the first version got that wrong:
/// it was mounted above the router, so the back gesture never reached it — back went to the screen
/// under the overlay while the overlay stayed up. A frame you cannot pop is not on the stack at all.
///
/// So it is a route (`/screen/:sessionId`) pushed as a NON-OPAQUE page: the app below keeps
/// rendering, the terminal is painted over it, and back pops exactly this frame — the same rule as
/// everywhere else in the app. It is deep-linkable for free, which is what the CLI's links need.
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import 'screen_link.dart';
import 'terminal_screen.dart';

/// Open the live screen for a session, over whatever is on screen now.
///
/// A push rather than a go: the frame goes ON TOP of where you are, and popping it puts you back
/// there rather than at some remembered location.
void openScene(BuildContext context, {required String sid, String? nickname}) {
  final name = nickname == null || nickname.isEmpty
      ? ''
      : '?name=${Uri.encodeQueryComponent(nickname)}';
  context.push('/screen/${Uri.encodeComponent(sid)}$name');
}

/// The page a router builds for that route. Non-opaque, so the app underneath is still drawn.
Page<void> sceneFrame({
  required String sessionId,
  String? nickname,
  ScreenSocket Function(Uri url)? connect,
}) => _ScenePage(sessionId: sessionId, nickname: nickname, connect: connect);

class _ScenePage extends Page<void> {
  const _ScenePage({
    required this.sessionId,
    required this.nickname,
    required this.connect,
  });

  final String sessionId;
  final String? nickname;
  final ScreenSocket Function(Uri url)? connect;

  @override
  Route<void> createRoute(BuildContext context) => PageRouteBuilder<void>(
    settings: this,
    // What makes it an overlay rather than a screen: the route below keeps painting.
    opaque: false,
    barrierColor: Colors.black54,
    barrierDismissible: true,
    transitionDuration: Duration.zero,
    reverseTransitionDuration: Duration.zero,
    pageBuilder: (context, _, _) =>
        SceneFrame(sessionId: sessionId, nickname: nickname, connect: connect),
  );
}

/// The terminal itself, with the ways out a frame is expected to have.
class SceneFrame extends StatelessWidget {
  const SceneFrame({
    required this.sessionId,
    this.nickname,
    this.connect,
    super.key,
  });

  final String sessionId;
  final String? nickname;
  final ScreenSocket Function(Uri url)? connect;

  @override
  Widget build(BuildContext context) {
    void close() {
      if (Navigator.of(context).canPop()) {
        Navigator.of(context).pop();
      } else {
        // Opened by a pasted link, with nothing underneath. Somewhere is better than a frame that
        // cannot be closed.
        GoRouter.of(context).go('/chats');
      }
    }

    return Focus(
      autofocus: true,
      // Escape, because that is what the React overlay answered to, and because a terminal owns
      // every other key on the keyboard — anything else would be a shortcut stolen from the program
      // you are watching.
      onKeyEvent: (node, event) {
        if (event is KeyDownEvent &&
            event.logicalKey == LogicalKeyboardKey.escape) {
          close();
          return KeyEventResult.handled;
        }
        return KeyEventResult.ignored;
      },
      child: Material(
        color: Colors.black,
        child: TerminalScreen(
          key: ValueKey(sessionId),
          sessionId: sessionId,
          title: nickname,
          connect: connect,
          onClose: close,
        ),
      ),
    );
  }
}
