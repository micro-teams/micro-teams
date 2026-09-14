// A dialog is a frame on the display stack, and back pops the top of the stack.
//
// It used not to be. `showDialog` pushes onto the Navigator directly, and on the web back is the
// browser's — answered by the router, which knew nothing about it. Pressing back closed the page
// under the dialog and left the dialog standing over whatever that revealed.

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:microteams/src/common/ui/app_dialog.dart';

Widget _app() {
  final router = GoRouter(
    routes: [
      GoRoute(
        path: '/',
        builder: (context, state) => Scaffold(
          body: Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text('the page underneath'),
                TextButton(
                  onPressed: () => context.push('/second'),
                  child: const Text('go deeper'),
                ),
              ],
            ),
          ),
        ),
      ),
      GoRoute(
        path: '/second',
        builder: (context, state) => Scaffold(
          body: Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text('the second page'),
                TextButton(
                  onPressed: () => showAppDialog<void>(
                    context,
                    builder: (context) =>
                        const AlertDialog(title: Text('a question')),
                  ),
                  child: const Text('ask'),
                ),
              ],
            ),
          ),
        ),
      ),
      GoRoute(
        path: appDialogPath,
        pageBuilder: (context, state) => appDialogPage<Object?>(state.extra),
      ),
    ],
  );
  return MaterialApp.router(routerConfig: router);
}

/// What the platform's back gesture does, and what a browser's back button reaches.
Future<void> back(WidgetTester tester) async {
  final context = tester.element(find.byType(Navigator).first);
  await Navigator.of(context).maybePop();
  await tester.pumpAndSettle();
}

void main() {
  _signedOut();
  testWidgets('back closes the dialog, not the page under it', (tester) async {
    await tester.pumpWidget(_app());
    await tester.tap(find.text('go deeper'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('ask'));
    await tester.pumpAndSettle();

    expect(find.text('a question'), findsOneWidget);
    expect(find.text('the second page'), findsOneWidget);

    await back(tester);

    expect(find.text('a question'), findsNothing, reason: 'the dialog goes');
    expect(
      find.text('the second page'),
      findsOneWidget,
      reason: 'and the page it was asked about stays',
    );

    // And only then does back mean what it meant before.
    await back(tester);
    expect(find.text('the page underneath'), findsOneWidget);
  });

  testWidgets('what the dialog is popped with is what the caller gets', (
    tester,
  ) async {
    String? answer = 'not answered';
    await tester.pumpWidget(
      MaterialApp.router(
        routerConfig: GoRouter(
          routes: [
            GoRoute(
              path: '/',
              builder: (context, state) => Scaffold(
                body: Center(
                  child: TextButton(
                    onPressed: () async {
                      answer = await showAppDialog<String>(
                        context,
                        builder: (context) => AlertDialog(
                          actions: [
                            TextButton(
                              onPressed: () => Navigator.pop(context, 'yes'),
                              child: const Text('yes'),
                            ),
                          ],
                        ),
                      );
                    },
                    child: const Text('ask'),
                  ),
                ),
              ),
            ),
            GoRoute(
              path: appDialogPath,
              pageBuilder: (context, state) =>
                  appDialogPage<Object?>(state.extra),
            ),
          ],
        ),
      ),
    );
    await tester.tap(find.text('ask'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('yes'));
    await tester.pumpAndSettle();
    expect(answer, 'yes');
  });

  testWidgets('a reload that lands on a dialog address leaves it', (
    tester,
  ) async {
    // `extra` does not survive a reload: a dialog is a question about what you were just doing, and
    // a question restored out of its context is one nobody can answer.
    await tester.pumpWidget(
      MaterialApp.router(
        routerConfig: GoRouter(
          initialLocation: '/',
          routes: [
            GoRoute(
              path: '/',
              builder: (context, state) => const Scaffold(
                body: Center(child: Text('the page underneath')),
              ),
            ),
            GoRoute(
              path: appDialogPath,
              pageBuilder: (context, state) =>
                  appDialogPage<Object?>(state.extra),
            ),
          ],
        ),
      ),
    );
    final context = tester.element(find.text('the page underneath'));
    unawaited(GoRouter.of(context).push(appDialogPath));
    await tester.pumpAndSettle();

    expect(find.text('the page underneath'), findsOneWidget);
  });
}

// A dialog opened before anybody is signed in.
//
// The settings a native client needs — which server to talk to — are asked for on the login screen,
// so the dialog route has to be reachable while signed out. It was not: the router's redirect sent
// every unknown location to /login, so pressing "settings" opened a second login screen.
void _signedOut() {
  testWidgets('a dialog is reachable before sign-in', (tester) async {
    final router = GoRouter(
      initialLocation: '/login',
      redirect: (context, state) {
        const anonymous = {'/login', '/register', appDialogPath};
        return anonymous.contains(state.matchedLocation) ? null : '/login';
      },
      routes: [
        GoRoute(
          path: '/login',
          builder: (context, state) => Scaffold(
            body: Center(
              child: TextButton(
                onPressed: () => showAppDialog<void>(
                  context,
                  builder: (context) =>
                      const AlertDialog(title: Text('settings')),
                ),
                child: const Text('settings'),
              ),
            ),
          ),
        ),
        GoRoute(
          path: appDialogPath,
          pageBuilder: (context, state) => appDialogPage<Object?>(state.extra),
        ),
      ],
    );

    await tester.pumpWidget(MaterialApp.router(routerConfig: router));
    await tester.tap(find.text('settings'));
    await tester.pumpAndSettle();

    expect(find.byType(AlertDialog), findsOneWidget);
  });
}
