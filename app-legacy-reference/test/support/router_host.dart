// A screen under a router, which is what the app itself is.
//
// Dialogs are routes here (see lib/src/common/ui/app_dialog.dart), because on the web back is the
// browser's and it is answered by the router: a dialog pushed outside the router got left standing
// while the page underneath it went back. That makes a plain `MaterialApp(home: …)` the wrong host
// for any test that opens one — there is no router for the dialog to be a route ON.

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:microteams/src/common/ui/app_dialog.dart';

/// [child] as the only screen, with the app's dialog route registered beside it.
Widget routed(Widget child, {ThemeData? theme}) => MaterialApp.router(
  theme: theme,
  routerConfig: GoRouter(
    routes: [
      GoRoute(path: '/', builder: (context, state) => child),
      GoRoute(
        path: appDialogPath,
        pageBuilder: (context, state) => appDialogPage<Object?>(state.extra),
      ),
    ],
  ),
);
