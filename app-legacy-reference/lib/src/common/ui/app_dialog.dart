/// A dialog that lives on the display stack, rather than beside it.
///
/// Flutter's `showDialog` pushes onto the Navigator directly, which is fine on a phone and wrong
/// here: on the web the back gesture is the browser's, it is answered by the ROUTER, and the router
/// knew nothing about a dialog somebody had pushed underneath it. Pressing back closed the page
/// beneath the dialog and left the dialog standing over whatever had been revealed.
///
/// So a dialog is a route like everything else — pushed as a non-opaque page over where you are,
/// exactly as the live screen is (see terminal/scene.dart). Back pops the dialog, because back
/// always pops the top of the stack, and there is now only one stack to be on top of.
///
/// The content is passed as a builder through `extra`, which does NOT survive a reload: a dialog is
/// a question about what you were just doing, and a question restored out of its context is a
/// question nobody can answer. A refresh on `/dialog` therefore lands on the page under it.
library;

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

/// The path the dialog route is registered at. One route serves every dialog in the app: what makes
/// them different is the widget, not the address.
const String appDialogPath = '/dialog';

/// Ask something, over whatever is on screen now.
///
/// Returns what the dialog popped with, or null when it was dismissed — the same contract
/// `showDialog` has, so a call site changes by one word.
Future<T?> showAppDialog<T>(
  BuildContext context, {
  required WidgetBuilder builder,
}) => GoRouter.of(context).push<T>(appDialogPath, extra: builder);

/// The page a router builds for that route.
Page<T> appDialogPage<T>(Object? extra) {
  final builder = extra is WidgetBuilder ? extra : null;
  return _DialogPage<T>(builder);
}

class _DialogPage<T> extends Page<T> {
  const _DialogPage(this.builder);

  final WidgetBuilder? builder;

  @override
  Route<T> createRoute(BuildContext context) => PageRouteBuilder<T>(
    settings: this,
    opaque: false,
    barrierColor: Colors.black54,
    barrierDismissible: true,
    barrierLabel: MaterialLocalizations.of(context).modalBarrierDismissLabel,
    transitionDuration: const Duration(milliseconds: 120),
    reverseTransitionDuration: const Duration(milliseconds: 90),
    transitionsBuilder: (context, animation, _, child) => FadeTransition(
      opacity: CurvedAnimation(parent: animation, curve: Curves.easeOut),
      child: child,
    ),
    pageBuilder: (context, _, _) => _DialogFrame(builder: builder),
  );
}

/// The dialog itself, plus the two ways out every frame in this app has: the barrier, and back.
class _DialogFrame extends StatelessWidget {
  const _DialogFrame({required this.builder});

  final WidgetBuilder? builder;

  @override
  Widget build(BuildContext context) {
    final content = builder;
    // A reload landed on the dialog's address with nothing to show. Leave, rather than sit on an
    // empty barrier the user has to guess their way out of.
    if (content == null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (context.mounted && Navigator.of(context).canPop()) {
          Navigator.of(context).pop();
        }
      });
      return const SizedBox.shrink();
    }
    return content(context);
  }
}
