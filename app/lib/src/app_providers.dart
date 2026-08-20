/// Everything the app is made of, declared once.
///
/// This file is the composition root: the only place that knows the auth client, the nt client,
/// the cache and the updates socket exist at the same time. Screens read providers; they never
/// construct any of this, which is what keeps a widget from quietly opening its own connection.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'auth/auth_api.dart';
import 'core/cache.dart';
import 'core/config.dart';
import 'core/errors.dart';
import 'mt/client.dart';
import 'updates/socket.dart';
import 'updates/store.dart';

final endpointsProvider = Provider<Endpoints>((ref) => defaultEndpoints());

/// Overridden at startup with the opened cache — see main.dart. The unopened default keeps tests
/// and any early read honest rather than null.
final cacheProvider = Provider<ReadCache>((ref) => ReadCache.inMemory());

final authApiProvider = Provider<AuthApi>((ref) {
  return AuthApi(baseUrl: ref.watch(endpointsProvider).auth);
});

final mtClientProvider = Provider<MtClient>((ref) {
  final client = MtClient(
    baseUrl: ref.watch(endpointsProvider).mt,
    // On a 401, ask the session to refresh silently through the cookie and hand back a fresh
    // token for a one-shot retry. Returning null means the session is genuinely over.
    reauthorize: () => ref.read(sessionProvider.notifier).reauthorize(),
  );
  return client;
});

final updatesStoreProvider = Provider<UpdatesStore>((ref) => UpdatesStore());

/// The socket lives as long as there is a signed-in session, and not a moment longer: dialling it
/// without a token gets a refusal that looks exactly like a server gone quiet.
final updatesSocketProvider = Provider<UpdatesSocket?>((ref) {
  final session = ref.watch(sessionProvider);
  final token = session.value?.accessToken;
  if (token == null) return null;

  final endpoints = ref.watch(endpointsProvider);
  final socket = UpdatesSocket(
    store: ref.watch(updatesStoreProvider),
    // Read the token per dial rather than closing over this one: a reconnect after a refresh must
    // carry the new token.
    url: () =>
        endpoints.updatesSocket(ref.read(sessionProvider).value?.accessToken),
  )..start();
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
    await ref.read(cacheProvider).setScope(null);
    state = const AsyncValue.data(null);
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
      await ref.read(cacheProvider).setScope(null);
      state = const AsyncValue.data(null);
      return null;
    }
  }

  Future<void> _adopt(Session session) async {
    ref.read(mtClientProvider).accessToken = session.accessToken;
    // Point the read cache at this user. A different user clears everything, so no account ever
    // paints another's cached reads.
    await ref.read(cacheProvider).setScope(session.user.id);
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
