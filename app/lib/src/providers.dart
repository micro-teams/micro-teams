/// Everything the app is made of, declared once.
///
/// This file is the composition root: the only place that knows the auth client, the nt client,
/// the cache and the updates socket exist at the same time. Screens read providers; they never
/// construct any of this, which is what keeps a widget from quietly opening its own connection.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'auth/auth_api.dart';
import 'package:multipath/multipath.dart' as mp;

import 'common/config.dart';
import 'common/errors.dart';
import 'common/key_value.dart';
import 'common/lines.dart';
import 'common/stream_lines.dart';
import 'common/api.dart';
import 'common/updates/socket.dart';
import 'common/updates/store.dart';

final endpointsProvider = Provider<Endpoints>((ref) => defaultEndpoints());

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
  );
  ref.onDispose(manager.stop);
  return manager;
});

final authApiProvider = Provider<AuthApi>((ref) {
  return AuthApi(baseUrl: ref.watch(endpointsProvider).auth);
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
      return streams.urlFor('/mt/updates$query');
    },
  );
  // Told when a dial succeeds and when it ends, so a line that accepts the handshake and drops it
  // is skipped for streams next time rather than retried forever.
  socket.onOpened = () => streams.opened(DateTime.now());
  socket.onClosed = () => streams.closed(DateTime.now());
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
      await ref.read(authApiProvider).logout();
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
  if (userId == null) ref.read(stateStoreProvider).clear();
}
