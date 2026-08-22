/// The one live screen, floating over whatever you were doing.
///
/// Watching an agent work is not a place you go: it is a thing you glance at. The React client had
/// this right — one overlay, mounted once above the whole app, opened by tapping any agent avatar
/// anywhere, closed with Escape, and underneath it everything is exactly where you left it. Making
/// it a route instead (which this client did first) means the list you were reading, the message
/// you were typing and the file you had open are all replaced by a terminal, and coming back is
/// your problem.
///
/// It is still deep-linkable: `/screen/:sessionId` opens the app with the overlay already up, so a
/// link somebody pastes still works.
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'screen_link.dart';
import 'terminal_screen.dart';

/// Whose screen is being watched.
class Scene {
  const Scene({required this.sessionId, this.nickname});

  final String sessionId;
  final String? nickname;
}

class SceneController extends Notifier<Scene?> {
  @override
  Scene? build() => null;

  void open(String sessionId, {String? nickname}) =>
      state = Scene(sessionId: sessionId, nickname: nickname);

  void close() => state = null;
}

final sceneProvider = NotifierProvider<SceneController, Scene?>(
  SceneController.new,
);

/// Mounted once, above the router. Draws nothing at all until there is something to watch.
class SceneOverlay extends ConsumerWidget {
  const SceneOverlay({this.connect, super.key});

  /// Replaces the socket the terminal dials. Only a test passes this, for the same reason
  /// [TerminalScreen] has the seam: an overlay that can only be exercised against a live machine is
  /// an overlay whose behaviour is never tested.
  final ScreenSocket Function(Uri url)? connect;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scene = ref.watch(sceneProvider);
    if (scene == null) return const SizedBox.shrink();

    void close() => ref.read(sceneProvider.notifier).close();

    return Positioned.fill(
      child: Focus(
        autofocus: true,
        // Escape, because that is what the React overlay answered to and because a terminal owns
        // every other key on the keyboard — anything else would be a shortcut stolen from the
        // program you are watching.
        onKeyEvent: (node, event) {
          if (event is KeyDownEvent &&
              event.logicalKey == LogicalKeyboardKey.escape) {
            close();
            return KeyEventResult.handled;
          }
          return KeyEventResult.ignored;
        },
        child: PopScope(
          // The phone's way out: the back gesture closes the overlay rather than leaving the screen
          // underneath it.
          canPop: false,
          onPopInvokedWithResult: (didPop, _) {
            if (!didPop) close();
          },
          child: Material(
            color: Colors.black,
            child: TerminalScreen(
              key: ValueKey(scene.sessionId),
              sessionId: scene.sessionId,
              title: scene.nickname,
              connect: connect,
              onClose: close,
            ),
          ),
        ),
      ),
    );
  }
}
