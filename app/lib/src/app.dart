/// The app: its routes, and the one shell both layouts share.
///
/// Two rules this file exists to keep.
///
/// One: a URL is a real address. /chats/206 has to be a link someone can send, a browser back
/// button has to work, and the same path has to open the same screen from an Android deep link.
/// That is why routing is declarative and lives here rather than in a stack of pushes.
///
/// Two: there is ONE set of screens. The phone shows one at a time with a bottom bar; a wide
/// window shows list-beside-detail with a rail. Both are this file arranging the same widgets —
/// the React client had two parallel shells and spent a whole refactor pass merging them back
/// together, which is a mistake worth not making twice.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'providers.dart';
import 'auth/login_screen.dart';
import 'auth/profile_screen.dart';
import 'auth/register_screen.dart';
import 'agents/agents_screen.dart';
import 'chats/chats_screen.dart';
import 'chats/thread_screen.dart';
import 'docs/docs_screen.dart';
import 'teams/team_screen.dart';
import 'teams/teams_screen.dart';
import 'terminal/terminal_screen.dart';
import 'common/ui/theme.dart';

class MicroTeamsApp extends ConsumerStatefulWidget {
  const MicroTeamsApp({super.key});

  @override
  ConsumerState<MicroTeamsApp> createState() => _MicroTeamsAppState();
}

class _MicroTeamsAppState extends ConsumerState<MicroTeamsApp>
    with WidgetsBindingObserver {
  late final GoRouter _router = _buildRouter(ref);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _router.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Coming back to the foreground refetches everything being watched, once. On a phone this is
    // the backstop that matters most: the OS suspends the process without telling anyone, and a
    // socket that was asleep cannot know what it missed.
    if (state == AppLifecycleState.resumed) {
      ref.read(updatesSocketProvider)?.resumed();
    }
  }

  @override
  Widget build(BuildContext context) {
    // Reading it here is what opens it, and closing the session closes it.
    ref.watch(updatesSocketProvider);

    return MaterialApp.router(
      title: 'MicroTeams',
      debugShowCheckedModeBanner: false,
      // One theme, and it is dark — see ui/theme.dart. Following the browser's preference is what
      // made this client open white on a machine set to light, next to a React client that had
      // exactly one `:root` and it was black.
      theme: darkTheme(),
      themeMode: ThemeMode.dark,
      routerConfig: _router,
    );
  }
}

GoRouter _buildRouter(WidgetRef ref) {
  return GoRouter(
    initialLocation: '/chats',
    refreshListenable: _SessionListenable(ref),
    redirect: (context, state) {
      final session = ref.read(sessionProvider);
      // Boot: we are still asking the refresh cookie who this is. Sending someone to /login here
      // is the bug that used to bounce a signed-in user out on every reload.
      if (session.isLoading) return null;

      final signedIn = session.value != null;
      // Both screens that exist before a session. Bouncing someone off /register back to /login
      // for not being signed in is how registration became unreachable.
      const anonymous = {'/login', '/register'};
      final atAnonymous = anonymous.contains(state.matchedLocation);
      if (!signedIn) return atAnonymous ? null : '/login';
      if (atAnonymous) return '/chats';
      return null;
    },
    routes: [
      GoRoute(
        path: '/login',
        pageBuilder: (context, state) => NoTransitionPage(
          child: LoginScreen(onRegister: () => context.go('/register')),
        ),
      ),
      GoRoute(
        path: '/register',
        pageBuilder: (context, state) => NoTransitionPage(
          child: RegisterScreen(onSignIn: () => context.go('/login')),
        ),
      ),
      ShellRoute(
        builder: (context, state, child) => _Shell(child: child),
        routes: [
          GoRoute(
            path: '/chats',
            pageBuilder: _page(const _ChatsPane()),
            routes: [
              GoRoute(
                path: ':threadId',
                pageBuilder: (context, state) {
                  final id =
                      int.tryParse(state.pathParameters['threadId'] ?? '') ?? 0;
                  return NoTransitionPage(child: _ChatsPane(openThreadId: id));
                },
              ),
            ],
          ),
          // Reachable by URL before the agents screen that will normally lead here has been
          // migrated, so the hardest part of this rewrite can be judged on a real device now
          // rather than after everything else is done.
          GoRoute(
            path: '/screen/:sessionId',
            pageBuilder: (context, state) => NoTransitionPage(
              child: TerminalScreen(
                sessionId: state.pathParameters['sessionId'] ?? '',
              ),
            ),
          ),
          GoRoute(
            path: '/docs',
            pageBuilder: (context, state) => NoTransitionPage(
              child: DocsScreen(
                openPath: state.uri.queryParameters['path'],
                onOpen: (path) => context.go(
                  path == null
                      ? '/docs'
                      : '/docs?path=${Uri.encodeQueryComponent(path)}',
                ),
              ),
            ),
          ),
          GoRoute(
            path: '/teams',
            pageBuilder: (context, state) => NoTransitionPage(
              child: TeamsScreen(
                onOpen: (team) => context.go('/teams/${team.id}'),
              ),
            ),
            routes: [
              GoRoute(
                path: ':teamId',
                pageBuilder: (context, state) {
                  final id =
                      int.tryParse(state.pathParameters['teamId'] ?? '') ?? 0;
                  return NoTransitionPage(
                    child: TeamScreen(
                      teamId: id,
                      onGone: () => context.go('/teams'),
                    ),
                  );
                },
              ),
            ],
          ),
          GoRoute(
            path: '/agents',
            pageBuilder: (context, state) => NoTransitionPage(
              child: AgentsScreen(
                // An agent with no session has no screen to watch, and the row does not offer one —
                // so reaching here means there is a sid.
                onOpenScreen: (agent) => context.go('/screen/${agent.sid}'),
                onOpenChat: (threadId) => context.go('/chats/$threadId'),
              ),
            ),
          ),
          GoRoute(path: '/profile', pageBuilder: _page(const ProfileScreen())),
        ],
      ),
    ],
  );
}

/// Every route is a [NoTransitionPage].
///
/// Material's default page transition slides and fades a screen in. That is right for a phone push
/// — a screen arriving on top of another — and wrong for everything this app actually does, which
/// is switch between tabs and between conversations. Those are not arrivals; there is no hierarchy
/// to animate. The React client had no such effect and nobody missed it.
GoRouterPageBuilder _page(Widget child) =>
    (context, state) => NoTransitionPage(child: child);

/// Rebuilds the router when the session changes, so the redirect above runs again.
class _SessionListenable extends ChangeNotifier {
  _SessionListenable(WidgetRef ref) {
    ref.listenManual(sessionProvider, (_, _) => notifyListeners());
  }
}

/// Chats, in whichever arrangement the window calls for.
///
/// One widget, two layouts. On a phone the open conversation covers the list; on a wide window it
/// sits beside it. Neither branch has its own copy of either screen.
class _ChatsPane extends ConsumerWidget {
  const _ChatsPane({this.openThreadId});

  final int? openThreadId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final wide = isWide(context);
    final open = openThreadId;

    if (!wide) {
      if (open != null) {
        return ThreadScreen(
          threadId: open,
          onOpenScreen: (sid) => context.go('/screen/$sid'),
        );
      }
      return Scaffold(
        appBar: AppBar(title: const Text('chats')),
        body: ChatsScreen(
          onOpen: (thread) => context.go('/chats/${thread.id}'),
        ),
      );
    }

    return Scaffold(
      body: Row(
        children: [
          SizedBox(
            width: Metrics.listPaneWidth,
            child: Scaffold(
              // The list is not something you can go back FROM — it is always there. Material
              // would add an arrow here just because /chats/1 can pop to /chats.
              appBar: AppBar(
                automaticallyImplyLeading: false,
                title: const Text('chats'),
              ),
              body: ChatsScreen(
                selectedId: open,
                dense: true,
                onOpen: (thread) => context.go('/chats/${thread.id}'),
              ),
            ),
          ),
          const VerticalDivider(width: 1),
          Expanded(
            child: open == null
                ? const Center(child: Text('pick a conversation'))
                // asPane: beside the list, not on top of it. No back button — see ThreadScreen.
                : ThreadScreen(
                    key: ValueKey(open),
                    threadId: open,
                    asPane: true,
                    onOpenScreen: (sid) => context.go('/screen/$sid'),
                  ),
          ),
        ],
      ),
    );
  }
}

/// The shell: a bottom bar on a phone, a rail on a wide window.
class _Shell extends StatelessWidget {
  const _Shell({required this.child});

  final Widget child;

  static const _destinations = [
    (
      path: '/chats',
      icon: Icons.forum_outlined,
      selected: Icons.forum,
      label: 'chats',
    ),
    (
      path: '/docs',
      icon: Icons.snippet_folder_outlined,
      selected: Icons.snippet_folder,
      label: 'docs',
    ),
    (
      path: '/teams',
      icon: Icons.groups_outlined,
      selected: Icons.groups,
      label: 'teams',
    ),
    (
      path: '/agents',
      icon: Icons.smart_toy_outlined,
      selected: Icons.smart_toy,
      label: 'agents',
    ),
    (
      path: '/profile',
      icon: Icons.person_outline,
      selected: Icons.person,
      label: 'me',
    ),
  ];

  int _indexOf(BuildContext context) {
    final location = GoRouterState.of(context).matchedLocation;
    final index = _destinations.indexWhere((d) => location.startsWith(d.path));
    return index < 0 ? 0 : index;
  }

  @override
  Widget build(BuildContext context) {
    final index = _indexOf(context);
    // On a phone an open conversation is a screen of its own; a bottom bar under it would be a
    // second way out that the back gesture already provides.
    final location = GoRouterState.of(context).matchedLocation;
    final immersive =
        !isWide(context) && RegExp(r'^/chats/\d+$').hasMatch(location);

    if (immersive) return child;

    if (isWide(context)) {
      return Scaffold(
        body: Row(
          children: [
            _Rail(
              index: index,
              destinations: _destinations,
              onSelected: (i) => context.go(_destinations[i].path),
            ),
            const VerticalDivider(width: 1),
            Expanded(child: child),
          ],
        ),
      );
    }

    return Scaffold(
      body: child,
      bottomNavigationBar: NavigationBar(
        selectedIndex: index,
        onDestinationSelected: (i) => context.go(_destinations[i].path),
        destinations: [
          for (final d in _destinations)
            NavigationDestination(
              icon: Icon(d.icon),
              selectedIcon: Icon(d.selected),
              label: d.label,
            ),
        ],
      ),
    );
  }
}

/// The desktop rail, drawn rather than configured.
///
/// Each destination is a 44px rounded SQUARE with the icon and the label both inside it, which is
/// what the React rail was (`size-11 rounded-lg text-[10px]`). Material's NavigationRail puts its
/// indicator around the icon alone and the label underneath, outside — a different shape that no
/// amount of theming reaches, and the difference is visible at a glance.
class _Rail extends StatelessWidget {
  const _Rail({
    required this.index,
    required this.destinations,
    required this.onSelected,
  });

  final int index;
  final List<({String path, IconData icon, IconData selected, String label})>
  destinations;
  final void Function(int) onSelected;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      width: Metrics.railWidth,
      padding: const EdgeInsets.symmetric(vertical: 12),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLow,
        border: Border(right: BorderSide(color: scheme.outlineVariant)),
      ),
      child: Column(
        children: [
          for (var i = 0; i < destinations.length; i++)
            Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: _RailItem(
                destination: destinations[i],
                active: i == index,
                onTap: () => onSelected(i),
              ),
            ),
        ],
      ),
    );
  }
}

class _RailItem extends StatelessWidget {
  const _RailItem({
    required this.destination,
    required this.active,
    required this.onTap,
  });

  final ({String path, IconData icon, IconData selected, String label})
  destination;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final colour = active ? scheme.primary : scheme.onSurfaceVariant;
    return Tooltip(
      message: destination.label,
      child: Material(
        color: active ? scheme.surfaceContainerHighest : Colors.transparent,
        borderRadius: BorderRadius.circular(6),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(6),
          child: SizedBox(
            width: Metrics.railItemSize,
            height: Metrics.railItemSize,
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(
                  active ? destination.selected : destination.icon,
                  size: Metrics.railIconSize,
                  color: colour,
                ),
                const SizedBox(height: 2),
                Text(
                  destination.label,
                  style: TextStyle(
                    fontSize: Metrics.railLabelSize,
                    height: 1,
                    color: colour,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
