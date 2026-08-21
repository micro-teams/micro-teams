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
import 'agents/agent_detail.dart';
import 'agents/agents_screen.dart';
import 'agents/machine_detail.dart';
import 'chats/chats_screen.dart';
import 'chats/new_chat_dialog.dart';
import 'chats/thread_info_screen.dart';
import 'chats/thread_screen.dart';
import 'docs/docs_screen.dart';
import 'teams/team_screen.dart';
import 'teams/teams_screen.dart';
import 'terminal/terminal_screen.dart';
import 'common/ui/avatar.dart';
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
    // Any avatar, anywhere, can ask for an agent's live screen — that is what made an avatar worth
    // tapping in the old client. How this app gets there is the shell's business, so the shell
    // says so once rather than every screen passing a callback down to every face it draws.
    openSceneHandler = (context, {required String sid}) =>
        context.go('/screen/$sid');
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
      // A branch per destination, each with its own Navigator and its own place in the URL.
      //
      // This is what "switching tabs does not throw your place away" is made of: an IndexedStack
      // keeps every visited branch alive, so scroll position, the file you had open, the
      // conversation you were reading and anything half-typed are all still there when you come
      // back — and the branch remembers its own location, so returning to docs returns to the file
      // rather than to the tree. The React shells did this by hand (MobileTabs / sectionKeepAlive)
      // because react-router unmounts a route on every navigation; go_router has it built in, and
      // rebuilding the world on every tab tap was the single biggest way this client did not feel
      // like the old one.
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) => _Shell(shell: shell),
        branches: [
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/chats',
                pageBuilder: _page(const _ChatsPane()),
                routes: [
                  GoRoute(
                    path: ':threadId',
                    pageBuilder: (context, state) {
                      final id =
                          int.tryParse(
                            state.pathParameters['threadId'] ?? '',
                          ) ??
                          0;
                      return NoTransitionPage(
                        child: _ChatsPane(openThreadId: id),
                      );
                    },
                    routes: [
                      // A place, not a sheet: a link to a chat's members is a link somebody can send,
                      // and the same screen serves both layouts so the two cannot grow different
                      // sets of actions the way the React shells did.
                      GoRoute(
                        path: 'info',
                        pageBuilder: (context, state) {
                          final id =
                              int.tryParse(
                                state.pathParameters['threadId'] ?? '',
                              ) ??
                              0;
                          return NoTransitionPage(
                            child: ThreadInfoScreen(
                              threadId: id,
                              onGone: () => context.go('/chats'),
                            ),
                          );
                        },
                      ),
                    ],
                  ),
                ],
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/docs',
                pageBuilder: (context, state) => NoTransitionPage(
                  child: DocsScreen(
                    onManageTeams: () => context.go('/teams'),
                    openPath: state.uri.queryParameters['path'],
                    onOpen: (path) => context.go(
                      path == null
                          ? '/docs'
                          : '/docs?path=${Uri.encodeQueryComponent(path)}',
                    ),
                  ),
                ),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
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
                          int.tryParse(state.pathParameters['teamId'] ?? '') ??
                          0;
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
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/agents',
                pageBuilder: _page(const _AgentsPane()),
                routes: [
                  // Selection lives in the URL, the way the React desktop had it: a link to an
                  // agent opens that agent, and back pops the frame rather than guessing.
                  GoRoute(
                    path: 'machine/:machineId',
                    pageBuilder: (context, state) => NoTransitionPage(
                      child: _AgentsPane(
                        openMachineId: state.pathParameters['machineId'],
                      ),
                    ),
                  ),
                  GoRoute(
                    path: ':userId',
                    pageBuilder: (context, state) {
                      final id =
                          int.tryParse(state.pathParameters['userId'] ?? '') ??
                          0;
                      return NoTransitionPage(
                        child: _AgentsPane(openAgentId: id),
                      );
                    },
                  ),
                ],
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/profile',
                pageBuilder: _page(const ProfileScreen()),
              ),
            ],
          ),
        ],
      ),
      // Outside the shell, because watching a live screen covers the app rather than sitting in a
      // tab. It is still a route for now; the React client floated it over everything as an
      // overlay, which is the next thing to fix here.
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
          onOpenInfo: () => context.go('/chats/$open/info'),
        );
      }
      return Scaffold(
        appBar: AppBar(title: const Text('chats'), actions: [_NewChatButton()]),
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
                actions: [_NewChatButton()],
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
                    onOpenInfo: () => context.go('/chats/$open/info'),
                  ),
          ),
        ],
      ),
    );
  }
}

/// Starting a conversation, from wherever the list is.
///
/// One widget rather than the same three lines in both layouts: the two shells having their own
/// copy of an action is exactly how the React client ended up with a rename on the phone and not
/// on the desktop.
class _NewChatButton extends StatelessWidget {
  @override
  Widget build(BuildContext context) => IconButton(
    tooltip: 'New chat',
    icon: const Icon(Icons.add_comment_outlined),
    onPressed: () async {
      final threadId = await showNewChatDialog(context);
      // Straight into it: a chat you made and were not taken to is a chat you have to go and find.
      if (threadId != null && context.mounted) context.go('/chats/$threadId');
    },
  );
}

/// Agents, in whichever arrangement the window calls for.
///
/// The same shape as [_ChatsPane], and for the same reason: on a phone the detail covers the list,
/// on a wide window it sits beside it, and neither branch has its own copy of either screen. The
/// React desktop had exactly this (`AgentsDesktop`), with the selection in the URL.
class _AgentsPane extends ConsumerWidget {
  const _AgentsPane({this.openAgentId, this.openMachineId});

  final int? openAgentId;
  final String? openMachineId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final wide = isWide(context);

    final list = AgentsScreen(
      selectedAgentId: openAgentId,
      selectedMachineId: openMachineId,
      dense: wide,
      onOpenAgent: (agent) => context.go('/agents/${agent.userId}'),
      onOpenMachine: (machine) => context.go('/agents/machine/${machine.id}'),
      onManageTeams: () => context.go('/teams'),
    );

    if (!wide) {
      if (openAgentId != null) {
        return AgentDetailScreen(
          userId: openAgentId!,
          onChat: (threadId) => context.go('/chats/$threadId'),
          onGone: () => context.go('/agents'),
        );
      }
      if (openMachineId != null) {
        return MachineDetailScreen(
          machineId: openMachineId!,
          onGone: () => context.go('/agents'),
        );
      }
      return list;
    }

    return Scaffold(
      body: Row(
        children: [
          SizedBox(width: Metrics.listPaneWidth, child: list),
          const VerticalDivider(width: 1),
          Expanded(
            child: switch ((openAgentId, openMachineId)) {
              (final int id, _) => AgentDetailScreen(
                key: ValueKey('agent-$id'),
                userId: id,
                asPane: true,
                onChat: (threadId) => context.go('/chats/$threadId'),
                onGone: () => context.go('/agents'),
              ),
              (_, final String id) => MachineDetailScreen(
                key: ValueKey('machine-$id'),
                machineId: id,
                asPane: true,
                onGone: () => context.go('/agents'),
              ),
              _ => const Center(child: Text('pick an agent or a machine')),
            },
          ),
        ],
      ),
    );
  }
}

/// The shell: a bottom bar on a phone, a rail on a wide window.
///
/// The chrome is OUTSIDE the stack and stays put. A detail — a conversation, an agent — is a frame
/// pushed inside it, so coming back out of one lands you where you were with the bar still there.
/// It used to hide the bar while a conversation was open, and coming back left the screen without
/// one at all: the shell decided from the URL, and the URL it read was not the one you had just
/// returned to.
class _Shell extends StatelessWidget {
  const _Shell({required this.shell});

  /// The live branch stack. Tapping a destination goes back to where that branch was, rather than
  /// to its root — which is the difference between a tab bar and five separate apps.
  final StatefulNavigationShell shell;

  /// Every branch, in the order they are declared on the router.
  ///
  /// Not all of them are destinations. The React shells had three rail items (chats, docs, agents)
  /// with the signed-in human's avatar pinned at the bottom, and team management was not a section
  /// at all — it was a surface drawn over docs, with the rail still reading "docs". Copying that is
  /// not deference to the old client: a rail item per route is how navigation grows until nothing
  /// on it is where anyone remembers.
  static const _branches = [
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

  /// Branch indices, by name, so the two shells can pick without counting.
  static const _chats = 0;
  static const _docs = 1;
  static const _teams = 2;
  static const _agents = 3;
  static const _profile = 4;

  /// What the rail offers: three, with the avatar underneath.
  static const _railItems = [_chats, _docs, _agents];

  /// What the bottom bar offers. Profile is a tab here because a phone has nowhere to pin an
  /// avatar menu — the React phone shell made the same call.
  static const _tabItems = [_chats, _docs, _agents, _profile];

  /// Switch branches. Tapping the branch you are already in goes to its root — the standard "tap
  /// the tab again to get back to the top" — and any other tap lands where that branch left off.
  void _go(int index) =>
      shell.goBranch(index, initialLocation: index == shell.currentIndex);

  @override
  Widget build(BuildContext context) {
    final index = shell.currentIndex;

    if (isWide(context)) {
      return Scaffold(
        body: Row(
          children: [
            _Rail(
              // Team management is a surface over docs, not a section of its own, so the rail
              // keeps reading "docs" while it is up — the same as the React shell.
              current: index == _teams ? _docs : index,
              items: [for (final i in _railItems) (branch: i, d: _branches[i])],
              onSelected: _go,
              onProfile: () => _go(_profile),
            ),
            const VerticalDivider(width: 1),
            Expanded(child: shell),
          ],
        ),
      );
    }

    return Scaffold(
      body: shell,
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tabItems
            .indexOf(index == _teams ? _docs : index)
            .clamp(0, _tabItems.length - 1),
        onDestinationSelected: (i) => _go(_tabItems[i]),
        destinations: [
          for (final i in _tabItems)
            NavigationDestination(
              icon: Icon(_branches[i].icon),
              selectedIcon: Icon(_branches[i].selected),
              label: _branches[i].label,
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
class _Rail extends ConsumerWidget {
  const _Rail({
    required this.current,
    required this.items,
    required this.onSelected,
    required this.onProfile,
  });

  /// The branch the rail highlights, which is not always the branch you are in — see the call site.
  final int current;

  /// The destinations, each carrying the branch it goes to.
  final List<
    ({
      int branch,
      ({String path, IconData icon, IconData selected, String label}) d,
    })
  >
  items;
  final void Function(int branch) onSelected;
  final VoidCallback onProfile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final user = ref.watch(sessionProvider).valueOrNull?.user;

    return Container(
      width: Metrics.railWidth,
      padding: const EdgeInsets.symmetric(vertical: 12),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLow,
        border: Border(right: BorderSide(color: scheme.outlineVariant)),
      ),
      child: Column(
        children: [
          for (final item in items)
            Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: _RailItem(
                // Keyed by destination so a test can point at the rail's own copy of a word: the
                // list pane's header says "chats" too.
                key: ValueKey('rail-${item.d.label}'),
                destination: item.d,
                active: item.branch == current,
                onTap: () => onSelected(item.branch),
              ),
            ),
          const Spacer(),
          // Pinned at the bottom, with your own picture in it — the React rail's shape, and the
          // only place on a wide window that says who you are signed in as.
          if (user != null)
            PopupMenuButton<int>(
              tooltip: user.nickname,
              position: PopupMenuPosition.over,
              onSelected: (choice) async {
                if (choice == 0) {
                  onProfile();
                  return;
                }
                await ref.read(sessionProvider.notifier).logout();
              },
              itemBuilder: (context) => const [
                PopupMenuItem(value: 0, child: Text('profile')),
                PopupMenuItem(value: 1, child: Text('log out')),
              ],
              child: UserAvatar(
                userId: user.id,
                nickname: user.nickname,
                avatarId: user.avatarId,
                size: 36,
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
    super.key,
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
