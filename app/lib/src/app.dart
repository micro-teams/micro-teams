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
import 'agents/connect_screen.dart';
import 'agents/machine_detail.dart';
import 'chats/chats_screen.dart';
import 'chats/new_chat_dialog.dart';
import 'chats/thread_info_screen.dart';
import 'chats/thread_screen.dart';
import 'docs/docs_screen.dart';
import 'teams/team_screen.dart';
import 'teams/teams_screen.dart';
import 'terminal/scene.dart';
import 'common/lines.dart';
import 'common/lines_screen.dart';
import 'common/ui/avatar.dart';
import 'common/ui/destination_button.dart';
import 'common/ui/app_dialog.dart';
import 'common/ui/detail_pane.dart';
import 'common/ui/theme.dart';
import 'common/server_version.dart';
import 'common/ui/must_update.dart';

/// Go somewhere that is not a frame.
///
/// Switching sections, or picking an item while its list stays on screen beside it: the
/// surroundings do not move, so nothing has been stacked on anything and back has nothing to
/// close. Without `neglect` each of these leaves a browser history entry, and back at the root of a
/// section then walks BACKWARDS THROUGH WHERE YOU HAVE BEEN — into the conversation before the one
/// you just left — which is not what back meant one press earlier. With it, the entries behind the
/// app are the ones from before the app, which is where back at the root should go.
void goLateral(BuildContext context, String location) =>
    Router.neglect(context, () => context.go(location));

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
    // tapping in the old client. It PUSHES a non-opaque frame: the app underneath keeps rendering,
    // and back pops the terminal rather than the screen beneath it.
    openSceneHandler = openScene;
    // Ask the deployment which lines exist, and route over them from here on.
    //
    // This call was missing entirely: `adoptRegistry` existed and nothing called it, so every
    // client ran on the inline same-origin line no matter what /mt/lines said — multi-line routing
    // was never once in effect. Nothing looked wrong either, because one working line is
    // indistinguishable from a routing layer with nothing to route between. The panel at /__lines
    // showing a single line is what finally said so.
    final lines = ref.read(linesProvider);
    unawaited(
      adoptRegistry(lines, ref.read(mtClientProvider).transport).then((_) {
        // Measuring starts after the registry arrives, because measuring one line and then being
        // handed three more is a table that is wrong for as long as the first interval lasts.
        lines.start();
      }),
    );
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    // Put the handler back, because it is global: leaving it pointing at this app's ref means the
    // next avatar to ask — in a test, after a hot restart — reaches into a container that is gone.
    openSceneHandler = null;
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

    // A native client that is a generation behind the deployment is stopped here, above the router
    // — not redirected to a route, because a route is somewhere you can navigate away from. On the
    // web this is always null: the launcher deals with a stale client by dropping its caches and
    // reloading, which needs nobody's cooperation. See common/server_version.dart.
    final mustUpdate = ref.watch(mustUpdateToProvider);
    if (mustUpdate != null) {
      return MaterialApp(
        title: 'MicroTeams',
        debugShowCheckedModeBanner: false,
        theme: darkTheme(),
        themeMode: ThemeMode.dark,
        home: MustUpdate(deployed: mustUpdate),
      );
    }

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

      // valueOrNull, not value: `value` RETHROWS when the provider is in an error state, and this
      // runs inside the router's redirect — where a throw means no route resolves at all, no first
      // frame is painted, and the loading screen sits at 100% forever with nothing to press. A
      // session that failed to restore is not a crash; it is somebody who is not signed in.
      final signedIn = session.valueOrNull != null;
      // A dialog is a frame over whatever is beneath it, so this gate has no opinion about it: it
      // belongs to the page underneath, signed in or not. Treating it as an ANONYMOUS address —
      // which is how it was let through while signed out — meant that pushing one while signed IN
      // was read as "you are on a login page, go to your chats", and every dialog in the app threw
      // the person to /chats instead of asking its question. Signing out was one of them: the
      // question never appeared, so nobody was ever signed out.
      if (state.matchedLocation == appDialogPath) return null;

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
                pageBuilder: _page(const _DocsPane()),
                routes: [
                  // A file is a frame of its own, so back closes the file rather than leaving
                  // docs altogether. Its path is a query parameter because a document's path
                  // contains slashes — it is a path inside a repository, not inside a URL.
                  GoRoute(
                    path: 'file',
                    pageBuilder: (context, state) => NoTransitionPage(
                      child: _DocsPane(
                        openPath: state.uri.queryParameters['path'],
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/teams',
                pageBuilder: _page(const _TeamsPane()),
                routes: [
                  GoRoute(
                    path: ':teamId',
                    pageBuilder: (context, state) {
                      final id =
                          int.tryParse(state.pathParameters['teamId'] ?? '') ??
                          0;
                      return NoTransitionPage(
                        child: _TeamsPane(openTeamId: id),
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
      // Every dialog in the app, at one address. On the display stack rather than beside it, so
      // that back closes the question rather than the page the question is about — see
      // common/ui/app_dialog.dart.
      GoRoute(
        path: appDialogPath,
        pageBuilder: (context, state) => appDialogPage<Object?>(state.extra),
      ),
      // Nothing links here. It is for the moment somebody asks "is it the network?" — see
      // common/lines_screen.dart.
      GoRoute(path: '/__lines', pageBuilder: _page(const LinesScreen())),
      // Where `microteams link auto-connect` sends a human. Outside the branches: it is not a
      // section, it is a thing you were sent to do once, and it leaves for /agents when done.
      GoRoute(
        path: '/connect',
        pageBuilder: (context, state) => NoTransitionPage(
          child: ConnectScreen(
            code: state.uri.queryParameters['code'] ?? '',
            onDone: () => context.go('/agents'),
          ),
        ),
      ),
      // A live screen is a frame over whatever you were doing, not a place you go: see
      // terminal/scene.dart. Non-opaque, so the app below keeps rendering, and back pops it.
      GoRoute(
        path: '/screen/:sessionId',
        pageBuilder: (context, state) => sceneFrame(
          sessionId: state.pathParameters['sessionId'] ?? '',
          nickname: state.uri.queryParameters['name'],
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
          onOpenScreen: (sid) => openScene(context, sid: sid),
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
                onOpen: (thread) => goLateral(context, '/chats/${thread.id}'),
              ),
            ),
          ),
          const VerticalDivider(width: 1),
          Expanded(
            child: DetailPane(
              child: open == null
                  ? const Center(
                      key: ValueKey('no-conversation'),
                      child: Text('pick a conversation'),
                    )
                  // asPane: beside the list, not on top of it. No back button — see ThreadScreen.
                  : ThreadScreen(
                      key: ValueKey(open),
                      threadId: open,
                      asPane: true,
                      onOpenScreen: (sid) => openScene(context, sid: sid),
                      onOpenInfo: () => context.go('/chats/$open/info'),
                    ),
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
      // Beside the list it is lateral; on a phone the detail replaces the list, so it is a frame.
      onOpenAgent: (agent) => wide
          ? goLateral(context, '/agents/${agent.userId}')
          : context.go('/agents/${agent.userId}'),
      onOpenMachine: (machine) => wide
          ? goLateral(context, '/agents/machine/${machine.id}')
          : context.go('/agents/machine/${machine.id}'),
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
          onOpenAgent: (agent) => context.go('/agents/${agent.userId}'),
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
                onGone: () => goLateral(context, '/agents'),
              ),
              (_, final String id) => MachineDetailScreen(
                key: ValueKey('machine-$id'),
                machineId: id,
                asPane: true,
                onGone: () => goLateral(context, '/agents'),
                onOpenAgent: (agent) =>
                    goLateral(context, '/agents/${agent.userId}'),
              ),
              _ => const Center(child: Text('pick an agent or a machine')),
            },
          ),
        ],
      ),
    );
  }
}

/// Documents, in whichever arrangement the window calls for.
///
/// The third of these, and deliberately the same shape as the other two: narrow shows the top
/// frame, wide shows the list beside it, back pops one frame. A section that arranged itself
/// differently would be a section people have to learn separately.
class _DocsPane extends StatelessWidget {
  const _DocsPane({this.openPath});

  final String? openPath;

  @override
  Widget build(BuildContext context) => DocsScreen(
    openPath: openPath,
    onManageTeams: () => context.go('/teams'),
    onOpen: (path) {
      final to = path == null
          ? '/docs'
          : '/docs/file?path=${Uri.encodeQueryComponent(path)}';
      // Beside the tree it is lateral; on a phone the document REPLACES the tree, so it is a frame
      // and back has to close it.
      isWide(context) ? goLateral(context, to) : context.go(to);
    },
  );
}

/// Teams, in whichever arrangement the window calls for.
class _TeamsPane extends StatelessWidget {
  const _TeamsPane({this.openTeamId});

  final int? openTeamId;

  @override
  Widget build(BuildContext context) {
    final wide = isWide(context);
    final open = openTeamId;

    final list = TeamsScreen(
      selectedId: open,
      onOpen: (team) => context.go('/teams/${team.id}'),
    );

    if (!wide) {
      if (open == null) return list;
      return TeamScreen(teamId: open, onGone: () => context.go('/teams'));
    }

    return Scaffold(
      body: Row(
        children: [
          SizedBox(width: Metrics.listPaneWidth, child: list),
          const VerticalDivider(width: 1),
          Expanded(
            child: open == null
                ? const Center(child: Text('pick a team'))
                : TeamScreen(
                    key: ValueKey(open),
                    teamId: open,
                    asPane: true,
                    onGone: () => context.go('/teams'),
                  ),
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
    Destination(
      path: '/chats',
      icon: Icons.forum_outlined,
      selected: Icons.forum,
      label: 'chats',
    ),
    Destination(
      path: '/docs',
      icon: Icons.snippet_folder_outlined,
      selected: Icons.snippet_folder,
      label: 'docs',
    ),
    Destination(
      path: '/teams',
      icon: Icons.groups_outlined,
      selected: Icons.groups,
      label: 'teams',
    ),
    Destination(
      path: '/agents',
      icon: Icons.smart_toy_outlined,
      selected: Icons.smart_toy,
      label: 'agents',
    ),
    Destination(
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
  void _go(BuildContext context, int index) => Router.neglect(
    context,
    () => shell.goBranch(index, initialLocation: index == shell.currentIndex),
  );

  @override
  Widget build(BuildContext context) {
    final path = GoRouterState.of(context).uri.path;
    // Back is a pop on the display tree, and at the root of the tree there is nothing to pop.
    //
    // What it used to do there was go back to wherever you had been BEFORE — the browser's own
    // history, which is a record of where you have been rather than of what is on top of what. So
    // leaving a conversation and pressing back again took you into the conversation you had been
    // in two screens ago, which is not what "back" had meant a moment earlier.
    //
    // What it does now is nothing. Leaving the site entirely would be the other honest answer, but
    // a page cannot count how many of the entries behind it are its own — a reload wipes that
    // knowledge while leaving the entries in place — so "go back to before MicroTeams" is not
    // something this can compute, and guessing would sometimes throw somebody out of the app.
    final atBranchRoot = _branches.any((d) => d.path == path);

    return PopScope(canPop: !atBranchRoot, child: _body(context));
  }

  Widget _body(BuildContext context) {
    final index = shell.currentIndex;
    final path = GoRouterState.of(context).uri.path;

    // Inside a conversation on a phone, the bar goes away — WeChat does not show one there, and the
    // conversation wants those pixels more than a tab bar does.
    //
    // Read from the router's current URL, not remembered anywhere: the last version of this decided
    // from a location it had captured earlier, so coming back out of a conversation left a screen
    // with no bar at all. What is on screen is a function of where you are, and where you are is
    // one thing, read once, here.
    final immersive =
        !isWide(context) && RegExp(r'^/chats/\d+$').hasMatch(path);
    if (immersive) return Scaffold(body: shell);

    if (isWide(context)) {
      return Scaffold(
        // SafeArea, because a tablet in landscape puts the status bar across the top of the whole
        // window: without it the rail's buttons and the divider run underneath the clock.
        body: SafeArea(
          bottom: false,
          child: Row(
            children: [
              _Rail(
                // Team management is a surface over docs, not a section of its own, so the rail
                // keeps reading "docs" while it is up — the same as the React shell.
                current: index == _teams ? _docs : index,
                items: [
                  for (final i in _railItems) (branch: i, d: _branches[i]),
                ],
                onSelected: (i) => _go(context, i),
                onProfile: () => _go(context, _profile),
              ),
              const VerticalDivider(width: 1),
              Expanded(child: shell),
            ],
          ),
        ),
      );
    }

    return Scaffold(
      body: shell,
      // The same buttons as the rail, in a row instead of a column. A shell decides where they go;
      // what they look like is not its business — see ui/destination_button.dart.
      bottomNavigationBar: Container(
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.surfaceContainerLow,
          border: Border(
            top: BorderSide(
              color: Theme.of(context).colorScheme.outlineVariant,
            ),
          ),
        ),
        child: SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                for (final i in _tabItems)
                  DestinationButton(
                    key: ValueKey('destination-${_branches[i].label}'),
                    destination: _branches[i],
                    active: i == (index == _teams ? _docs : index),
                    onTap: () => _go(context, i),
                  ),
              ],
            ),
          ),
        ),
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
  final List<({int branch, Destination d})> items;
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
              child: DestinationButton(
                // Keyed by destination so a test can point at this copy of a word: the list pane's
                // header says "chats" too.
                key: ValueKey('destination-${item.d.label}'),
                destination: item.d,
                active: item.branch == current,
                onTap: () => onSelected(item.branch),
              ),
            ),
          const Spacer(),
          // Your own face, pinned at the bottom — the React rail's shape, and the only thing on a
          // wide window that says who you are signed in as.
          //
          // It opens the profile, rather than a menu offering "profile" and "log out": logging out
          // is already inside the profile, and a two-item menu in front of a page that contains one
          // of the two items is a door in front of a door.
          if (user != null)
            Tooltip(
              message: user.nickname,
              child: InkWell(
                key: const ValueKey('destination-me'),
                borderRadius: BorderRadius.circular(Metrics.avatarRadius),
                onTap: onProfile,
                child: Padding(
                  padding: const EdgeInsets.all(4),
                  child: UserAvatar(
                    userId: user.id,
                    nickname: user.nickname,
                    avatarId: user.avatarId,
                    size: 36,
                    // It is you: there is no live screen behind your own face, and a tap here means
                    // "my profile".
                    clickable: false,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
