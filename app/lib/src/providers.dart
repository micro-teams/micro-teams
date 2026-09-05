/// Everything the app is made of, declared once.
///
/// This file is the composition root: the only place that knows the auth client, the nt client,
/// the cache and the updates socket exist at the same time. Screens read providers; they never
/// construct any of this, which is what keeps a widget from quietly opening its own connection.
library;

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'agents/agents_controller.dart';
import 'auth/auth_api.dart';
import 'chats/chats_controller.dart';
import 'chats/thread_controller.dart';
import 'chats/thread_info_controller.dart';
import 'docs/docs_controller.dart';
import 'teams/team_admin_controller.dart';
import 'package:multipath/multipath.dart' as mp;

import 'common/config.dart';
import 'common/presence_controller.dart';
import 'common/team_scope.dart';
import 'common/errors.dart';
import 'common/key_value.dart';
import 'common/lines.dart';
import 'common/multipath_adapter.dart';
import 'common/prefs_store.dart';
import 'common/stream_lines.dart';
import 'common/api.dart';
import 'common/updates/socket.dart';
import 'common/updates/store.dart';

/// Where this run talks to.
///
/// Watches the stored server so that changing it at sign-in rebuilds everything underneath —
/// the clients, the line manager, the sockets — rather than leaving half the app talking to the
/// previous one. On the web the setting is not consulted at all: the page's own origin IS the
/// server, and a client that could point elsewhere would be a client that can be pointed at a
/// server that never set its cookie.
final endpointsProvider = Provider<Endpoints>((ref) {
  return endpointsFor(saved: ref.watch(serverProvider));
});

/// Which server a native client talks to, as chosen at sign-in.
///
/// A notifier rather than a read of the store, because everything below it — the clients, the line
/// manager, the sockets — has to be rebuilt when it changes. Reading the store directly would give
/// the right answer once and never again.
class ServerSetting extends Notifier<String?> {
  @override
  String? build() => ref.read(stateStoreProvider).get(serverSetting);

  void use(String origin) {
    final chosen = trimTrailingSlash(origin.trim());
    if (chosen == state) return;
    ref.read(stateStoreProvider).set(serverSetting, chosen);
    state = chosen;
  }
}

final serverProvider = NotifierProvider<ServerSetting, String?>(
  ServerSetting.new,
);

/// What the same request returned last time. MultiPath's, so the keys, the scoping, the eviction
/// and the expiry are the rules every client in the org shares — and so nothing in this app has to
/// invent a cache key ever again.
///
/// Overridden at startup with a disk-backed one — see main.dart. The in-memory default keeps tests
/// and any early read honest rather than null.
final requestCacheProvider = Provider<mp.RequestCache>(
  (ref) => mp.RequestCache(),
);

/// The app's own small state — the outbox, and anything else that must survive being killed but is
/// not an answer to a request. See common/key_value.dart for why the two are not the same shelf.
final stateStoreProvider = Provider<KeyValueStore>(
  (ref) => KeyValueStore.inMemory(),
);

/// Which network paths this app may reach the backend over. One manager for the whole app: two
/// would be two opinions about which line is fastest, each blind to what the other measured.
/// The lines this app may reach the backend over.
///
/// It starts with the one line every client already has — the origin the page came from. The
/// deployment's real registry is adopted at startup by the composition root (see app.dart), which
/// is where it has to happen: the client that asks `/mt/lines` is built FROM this manager, so this
/// provider cannot ask for it without asking for itself.
final linesProvider = Provider<mp.LineManager>((ref) {
  final manager = mp.LineManager(
    registry: sameOriginOnly(),
    // How a probe is sent. Without it the manager measures nothing and ranks on configured weight —
    // which is what this client did until now, and why every line but the one real traffic happened
    // to use sat at "never measured" forever.
    send: probeSender(origin: ref.watch(endpointsProvider).origin),
    // What the last visit measured, so the ranking does not start from the registry's fixed order
    // every time. start() seeds from it in the background; stop() writes it back.
    storage: const PrefsHealthStore(),
  );
  ref.onDispose(manager.stop);
  return manager;
});

final authApiProvider = Provider<AuthApi>((ref) {
  return AuthApi(
    baseUrl: ref.watch(endpointsProvider).auth,
    // The browser keeps the refresh cookie itself, and keeps it httpOnly, which is a property
    // nothing on this side of the wire can match. A native client has no browser: without somewhere
    // to put that cookie it is signed out the moment its access token ages out, which is exactly
    // what an Android client was doing.
    cookies: kIsWeb
        ? const BrowserCookies()
        : StoredCookies(ref.watch(stateStoreProvider)),
    // Signing in and staying signed in go over the same lines as everything else — on a native
    // client only.
    //
    // Without this, every other request in the app fails over to a working line and the SESSION
    // does not: the refresh that keeps it alive goes to the one origin, and when that origin is the
    // unreachable one the client is signed out while a perfectly good line sits beside it. Which is
    // the exact situation the lines exist for.
    //
    // In a browser this is not ours to do. The refresh token is an httpOnly cookie the page cannot
    // read, and it is bound to the origin that set it; sending the request to another origin sends
    // it without the cookie. A native client holds that cookie itself (see StoredCookies), so it
    // can carry it to whichever line answers.
    route: kIsWeb
        ? null
        : (inner) =>
              MultiPathAdapter(manager: ref.watch(linesProvider), inner: inner),
  );
});

/// Measures every line, now. The panel's refresh button; the loop runs on its own once started.
final probeLinesProvider = Provider<Future<void> Function()>((ref) {
  final manager = ref.watch(linesProvider);
  return manager.probeNow;
});

final mtClientProvider = Provider<MtClient>((ref) {
  final client = MtClient(
    baseUrl: ref.watch(endpointsProvider).mt,
    lines: ref.watch(linesProvider),
    cache: ref.watch(requestCacheProvider),
    // On a 401, ask the session to refresh silently through the cookie and hand back a fresh
    // token for a one-shot retry. Returning null means the session is genuinely over.
    reauthorize: () => ref.read(sessionProvider.notifier).reauthorize(),
  );
  return client;
});

final updatesStoreProvider = Provider<UpdatesStore>((ref) => UpdatesStore());

/// Which line the app's long-lived connections leave by.
///
/// Its own policy, separate from the request ranking, because holding a stream and answering a
/// request quickly are different abilities — see common/stream_lines.dart. Ranked lines are read
/// afresh on every dial, so a line that has since been measured faster is used on the next
/// reconnect rather than at the next restart.
final streamLinesProvider = Provider<StreamLines>((ref) {
  final manager = ref.watch(linesProvider);
  return StreamLines(
    selector: mp.StreamSelector(lines: () => manager.ranked),
    endpoints: ref.watch(endpointsProvider),
  );
});

/// The socket lives as long as there is a signed-in session, and not a moment longer: dialling it
/// without a token gets a refusal that looks exactly like a server gone quiet.
final updatesSocketProvider = Provider<UpdatesSocket?>((ref) {
  final session = ref.watch(sessionProvider);
  final token = session.valueOrNull?.accessToken;
  if (token == null) return null;

  final streams = ref.watch(streamLinesProvider);
  StreamDial? dial;
  final socket = UpdatesSocket(
    store: ref.watch(updatesStoreProvider),
    // Read the token per dial rather than closing over this one: a reconnect after a refresh must
    // carry the new token — and pick the line per dial too, so a line that cannot hold a stream is
    // dropped on the next attempt rather than retried forever.
    url: () {
      final live = ref.read(sessionProvider).valueOrNull?.accessToken;
      final query = live == null || live.isEmpty
          ? ''
          : '?token=${Uri.encodeComponent(live)}';
      dial = streams.dial('/mt/updates$query');
      return dial!.url;
    },
  );
  // Told when a dial succeeds and when it ends, so a line that accepts the handshake and drops it
  // is skipped for streams next time rather than retried forever.
  socket.onOpened = () => dial?.opened(DateTime.now());
  socket.onClosed = () => dial?.closed(DateTime.now());
  socket.start();
  ref.onDispose(socket.close);
  return socket;
});

/// Who is signed in.
///
/// `AsyncValue<Session?>`: loading is boot (we are asking the refresh cookie who this is), data
/// with null is "definitely signed out", data with a session is signed in. A screen that treats
/// loading as signed-out is the bug that used to bounce people to the login page on a reload.
class SessionController extends AsyncNotifier<Session?> {
  @override
  Future<Session?> build() async {
    return _restore();
  }

  /// Restore the session from the refresh cookie.
  ///
  /// A 401 means there is genuinely no valid cookie — accept it. A transient failure (no network,
  /// a 5xx from the proxy) must NOT drop a signed-in user to the login screen, so retry those a
  /// couple of times first. This distinction is load-bearing and was learned from a real bug.
  Future<Session?> _restore() async {
    final api = ref.read(authApiProvider);
    for (var attempt = 0; ; attempt++) {
      try {
        final session = await api.refresh();
        await _adopt(session);
        return session;
      } on AuthError catch (e) {
        if (!e.isTransient || attempt >= 2) return null;
        await Future<void>.delayed(Duration(milliseconds: 400 * (attempt + 1)));
      }
    }
  }

  Future<void> login(String username, String password) async {
    state = const AsyncValue.loading();
    state = await AsyncValue.guard(() async {
      final session = await ref.read(authApiProvider).login(username, password);
      await _adopt(session);
      return session;
    });
  }

  Future<void> register({
    required String username,
    required String nickname,
    required String password,
    required String email,
    required String emailCode,
  }) async {
    state = const AsyncValue.loading();
    state = await AsyncValue.guard(() async {
      final session = await ref
          .read(authApiProvider)
          .register(
            username: username,
            nickname: nickname,
            password: password,
            email: email,
            emailCode: emailCode,
          );
      await _adopt(session);
      return session;
    });
  }

  Future<void> logout() async {
    try {
      final token = state.valueOrNull?.accessToken;
      if (token != null) await ref.read(authApiProvider).logout(token);
    } on AuthError {
      // The server refusing to hear about it does not keep us signed in locally.
    }
    ref.read(mtClientProvider).accessToken = null;
    _scopeTo(ref, null);
    state = const AsyncValue.data(null);
  }

  /// Re-read the signed-in human's own profile, keeping the token.
  ///
  /// Used after changing something about yourself — an avatar, a name — so every screen showing
  /// you reads the new one. A refresh() here would work too and would also rotate the refresh
  /// cookie, which is a lot of machinery to move for a picture.
  Future<void> refreshMe() async {
    final current = state.value;
    if (current == null) return;
    try {
      final user = await ref.read(authApiProvider).me(current.accessToken);
      state = AsyncValue.data(
        Session(user: user, accessToken: current.accessToken),
      );
    } on AuthError {
      // Not worth signing anyone out over: the change landed on the server either way, and the
      // next thing that reads the profile will see it.
    }
  }

  /// Called by the nt client on a 401. Returns a fresh token, or null if the session is over.
  Future<String?> reauthorize() async {
    try {
      final session = await ref.read(authApiProvider).refresh();
      await _adopt(session);
      state = AsyncValue.data(session);
      return session.accessToken;
    } on AuthError {
      ref.read(mtClientProvider).accessToken = null;
      _scopeTo(ref, null);
      state = const AsyncValue.data(null);
      return null;
    }
  }

  Future<void> _adopt(Session session) async {
    ref.read(mtClientProvider).accessToken = session.accessToken;
    // Point the read cache at this user. A different user clears everything, so no account ever
    // paints another's cached reads.
    _scopeTo(ref, session.user.id);
  }
}

final sessionProvider = AsyncNotifierProvider<SessionController, Session?>(
  SessionController.new,
);

/// Watch a topic from inside a provider: refetch whenever the server says it moved, and answer the
/// periodic check with what this feature currently holds.
///
/// This is the whole subscription API a feature needs, and it is deliberately only available to a
/// provider — never to a widget. A screen that could subscribe by itself is a screen that can hold
/// data, and then there are two paths to the pixels instead of one.
///
/// If a feature ever needs more than this, the sync layer has been designed wrong.
void watchTopic(
  Ref ref,
  String topic, {
  required void Function(SyncReason reason) onChange,
  String? Function()? digest,
}) {
  final store = ref.read(updatesStoreProvider);
  final drop = store.subscribe(
    topic,
    TopicListener(onChange: onChange, digest: digest),
  );
  ref.onDispose(drop);
}

/// Point everything that remembers things at this account, or at nobody.
///
/// One function because the two shelves must move together: a request cache scoped to a new user
/// while an outbox still held the previous one's unsent messages would show one account another's
/// writing. Entries are dropped rather than hidden — waiting in memory to become reachable again is
/// exactly the accident this prevents.
void _scopeTo(Ref ref, int? userId) {
  ref.read(requestCacheProvider).setScope(userId == null ? '' : '$userId');
  if (userId == null) {
    ref.read(stateStoreProvider).clear(keep: const {serverSetting});
  }
}

/// Everything holding one account's answers, dropped whenever the account changes.
///
/// Dropped by `dropWhatTheLastAccountFetched`, called from a listener at the root rather than from
/// _scopeTo: invalidating these from inside the session notifier is a cycle, because they are the
/// providers that watch it. (Riverpod says so with a CircularDependencyError, and what a person
/// sees is a registration that never finishes.)
///
/// Clearing the two shelves above is not enough on its own: a controller that already fetched is a
/// third place the data lives, and it outlives a sign-out because none of these are autoDispose.
/// The journey found the shape of that: a second person signed in, walked to the first person's
/// conversation, and read it off a controller still holding what it fetched in the previous
/// session — while the server refused every request behind it with a 403.
///
/// A list is a thing that rots, so `test/architecture_test.dart` fails when a provider is added to
/// a feature directory and not named here or exempted there.
final userScopedProviders = <ProviderOrFamily>[
  chatsProvider,
  threadProvider,
  threadInfoProvider,
  agentsProvider,
  driversProvider,
  allMachinesProvider,
  agentPresenceProvider,
  docsTreeProvider,
  docProvider,
  docHistoryProvider,
  docDiffProvider,
  docsAdminProvider,
  // Not an answer from the server, but the paths it holds are the previous account's folder names.
  docsTreeViewProvider,
  teamsProvider,
  currentTeamProvider,
  teamAdminProvider,
  teamRosterProvider,
];

/// Drop them. Call this when the signed-in account changes — see MicroTeamsApp.
void dropWhatTheLastAccountFetched(WidgetRef ref) {
  for (final provider in userScopedProviders) {
    ref.invalidate(provider);
  }
}
