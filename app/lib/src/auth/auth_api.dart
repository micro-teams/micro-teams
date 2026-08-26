/// Client for cheese-auth's /users/… endpoints.
///
/// Two things make this different from the nt client and are worth stating rather than
/// discovering: responses are wrapped in a {code, message, data} envelope, and the session is kept
/// alive by an httpOnly REFRESH_TOKEN cookie that the caller never sees.
///
/// The cookie is why [refresh] exists at all, and why the web build talks to a same-origin proxy.
/// On a native build there is no browser to hold a cookie, so Dio's cookie handling has to; that
/// seam is [CookieHolder], and it is the only place the two worlds differ.
library;

import 'dart:convert';

import 'package:dio/dio.dart';

import '../common/errors.dart';
import '../common/key_value.dart';

class AuthUser {
  const AuthUser({
    required this.id,
    required this.username,
    required this.nickname,
    required this.avatarId,
    required this.intro,
  });

  factory AuthUser.fromJson(Map<String, Object?> json) => AuthUser(
    id: (json['id'] as num).toInt(),
    username: json['username'] as String? ?? '',
    nickname: json['nickname'] as String? ?? '',
    avatarId: (json['avatarId'] as num?)?.toInt() ?? 0,
    intro: json['intro'] as String? ?? '',
  );

  final int id;
  final String username;
  final String nickname;
  final int avatarId;
  final String intro;
}

class Session {
  const Session({required this.user, required this.accessToken});

  final AuthUser user;
  final String accessToken;
}

/// Where the refresh cookie lives on platforms that have no browser.
///
/// On the web this is deliberately a no-op: the browser holds an httpOnly cookie that JavaScript —
/// and therefore Dart — must not be able to read, which is the entire security property. Anything
/// that "fixes" that has broken it.
abstract class CookieHolder {
  const CookieHolder();

  Future<void> attach(RequestOptions options);
  Future<void> capture(Response<Object?> response);

  /// Forget everything held. Called when a session ends, so that a logout the server did not hear
  /// about is still a logout here.
  Future<void> clear();
}

class BrowserCookies extends CookieHolder {
  const BrowserCookies();

  @override
  Future<void> attach(RequestOptions options) async {}

  @override
  Future<void> capture(Response<Object?> response) async {}

  @override
  Future<void> clear() async {}
}

/// The cookie jar for a client that has no browser.
///
/// Small on purpose: the only cookie in this system is the refresh token, and what has to survive
/// about it is its value. Paths, domains and the rest belong to a jar that serves many origins; a
/// native client talks to exactly one, chosen at sign-in, and everything it remembers is thrown away
/// when that changes.
///
/// Without this, a native client is signed out the moment its access token ages out: the server
/// sets the refresh cookie, nothing keeps it, and the silent refresh has nothing to send. On the web
/// the browser does all of this, and does it better — the cookie is httpOnly there, which is a
/// property no client-side store can have.
class StoredCookies extends CookieHolder {
  StoredCookies(this._store, {this.key = 'cookies'});

  final KeyValueStore _store;
  final String key;

  Map<String, String> _read() {
    final raw = _store.get(key);
    if (raw == null || raw.isEmpty) return {};
    try {
      final decoded = jsonDecode(raw);
      return decoded is Map
          ? {
              for (final entry in decoded.entries)
                '${entry.key}': '${entry.value}',
            }
          : {};
    } catch (_) {
      // Unreadable is the same as absent: ask the person to sign in again rather than fail here.
      return {};
    }
  }

  @override
  Future<void> attach(RequestOptions options) async {
    final jar = _read();
    if (jar.isEmpty) return;
    options.headers['Cookie'] = jar.entries
        .map((entry) => '${entry.key}=${entry.value}')
        .join('; ');
  }

  @override
  Future<void> capture(Response<Object?> response) async {
    final set = response.headers.map['set-cookie'];
    if (set == null || set.isEmpty) return;
    final jar = _read();
    for (final header in set) {
      final pair = header.split(';').first.trim();
      final split = pair.indexOf('=');
      if (split <= 0) continue;
      final name = pair.substring(0, split);
      final value = pair.substring(split + 1);
      // A server deletes a cookie by sending it back empty, or with an age of zero. Storing that as
      // a value would keep sending a cookie the server has already disowned.
      final deleted =
          value.isEmpty ||
          header.toLowerCase().contains('max-age=0') ||
          header.toLowerCase().contains('expires=thu, 01 jan 1970');
      if (deleted) {
        jar.remove(name);
      } else {
        jar[name] = value;
      }
    }
    _store.set(key, jsonEncode(jar));
  }

  @override
  Future<void> clear() async {
    _store.set(key, null);
  }
}

class AuthApi {
  AuthApi({
    required String baseUrl,
    CookieHolder cookies = const BrowserCookies(),
    HttpClientAdapter? adapter,
    HttpClientAdapter Function(HttpClientAdapter inner)? route,
  }) : _cookies = cookies,
       _dio = Dio(
         BaseOptions(
           baseUrl: baseUrl,
           // An envelope is still an envelope when it says no, so read the body on every status
           // and let _unwrap decide.
           validateStatus: (_) => true,
           headers: const {'Content-Type': 'application/json'},
           extra: const {'withCredentials': true},
         ),
       ) {
    // The one seam a test needs: everything else about this class is the wire.
    if (adapter != null) _dio.httpClientAdapter = adapter;
    // And the one place a line is chosen for the identity service. See providers.dart for why this
    // is offered on a native client and not in a browser.
    if (route != null) {
      _dio.httpClientAdapter = route(_dio.httpClientAdapter);
    }
  }

  final Dio _dio;
  final CookieHolder _cookies;

  Future<void> sendEmailVerifyCode(String email) async {
    await _post<Object?>('/users/verify/email', {'email': email});
  }

  Future<Session> register({
    required String username,
    required String nickname,
    required String password,
    required String email,
    required String emailCode,
  }) async {
    final data = await _post<Map<String, Object?>>('/users/', {
      'username': username,
      'nickname': nickname,
      'password': password,
      'email': email,
      'emailCode': emailCode,
    });
    return _session(data);
  }

  Future<Session> login(String username, String password) async {
    final data = await _post<Map<String, Object?>>('/users/auth/login', {
      'username': username,
      'password': password,
    });
    return _session(data);
  }

  /// The refresh token is single-use and rotates on every call: each refresh consumes the current
  /// cookie and sets a new one. If two refreshes fire at once they both send the same cookie — one
  /// wins and rotates it, and the loser's response can clobber the freshly-rotated cookie, killing
  /// the session on every restart. So while one refresh is in flight, everyone shares it.
  ///
  /// This bit is not theoretical: it is the bug that made the React app sign people out on reload.
  Future<Session> refresh() {
    return _inflightRefresh ??= _refresh().whenComplete(() {
      _inflightRefresh = null;
    });
  }

  Future<Session>? _inflightRefresh;

  Future<Session> _refresh() async {
    final data = await _post<Map<String, Object?>>(
      '/users/auth/refresh-token',
      const {},
    );
    return _session(data);
  }

  /// Ends the session on the server, which needs to know WHOSE session: the endpoint is
  /// authenticated, and without the token it answers 401 and keeps the refresh cookie alive. That
  /// looks like a logout locally and undoes itself on the next reload, because boot refreshes with
  /// a cookie the server never disowned.
  Future<void> logout(String accessToken) async {
    try {
      await _request<Object?>(
        '/users/auth/logout',
        method: 'POST',
        body: const {},
        accessToken: accessToken,
      );
    } finally {
      // Whatever the server said, this client is done with the cookie.
      await _cookies.clear();
    }
  }

  Future<AuthUser> me(String accessToken) async {
    final data = await _request<Map<String, Object?>>(
      '/users/me',
      method: 'GET',
      accessToken: accessToken,
    );
    return AuthUser.fromJson(data['user']! as Map<String, Object?>);
  }

  /// Upload an image and get cheese-auth's id for it.
  ///
  /// The picture goes to the identity service as the SIGNED-IN HUMAN, always — even when the
  /// avatar being changed belongs to an agent. Only pointing a profile at the resulting id differs
  /// between the two, and that difference is the caller's (see `ChangeAvatar`).
  Future<int> uploadAvatar({
    required List<int> bytes,
    required String filename,
    required String accessToken,
  }) async {
    final form = FormData.fromMap({
      'avatar': MultipartFile.fromBytes(bytes, filename: filename),
    });
    final response = await _dio.post<Object?>(
      '/avatars',
      data: form,
      options: Options(
        headers: {'Authorization': 'Bearer $accessToken'},
        // Dio sets the multipart content type, boundary and all; the JSON default from
        // BaseOptions would make the server read the body as a broken document.
        contentType: null,
      ),
    );
    final envelope = response.data;
    final status = response.statusCode ?? 0;
    if (envelope is! Map<String, Object?> || status < 200 || status >= 300) {
      final message = envelope is Map<String, Object?>
          ? envelope['message']
          : null;
      throw AuthError(message is String ? message : 'HTTP $status', status);
    }
    return (envelope['data']! as Map<String, Object?>)['avatarId']! as int;
  }

  /// Write the caller's own profile.
  ///
  /// cheese-auth replaces the whole profile, so the fields that are not changing have to be sent
  /// back unchanged — sending only the avatar id blanks the nickname and the intro.
  Future<void> updateProfile({
    required int userId,
    required String nickname,
    required String intro,
    required int avatarId,
    required String accessToken,
  }) async {
    await _request<Object?>(
      '/users/$userId',
      method: 'PUT',
      body: {'nickname': nickname, 'intro': intro, 'avatarId': avatarId},
      accessToken: accessToken,
    );
  }

  Session _session(Map<String, Object?> data) => Session(
    user: AuthUser.fromJson(data['user']! as Map<String, Object?>),
    accessToken: data['accessToken']! as String,
  );

  Future<T> _post<T>(String path, Map<String, Object?> body) =>
      _request<T>(path, method: 'POST', body: body);

  Future<T> _request<T>(
    String path, {
    required String method,
    Map<String, Object?>? body,
    String? accessToken,
  }) async {
    final options = Options(
      method: method,
      headers: {
        if (accessToken != null) 'Authorization': 'Bearer $accessToken',
      },
    );

    final Response<Object?> response;
    try {
      // Attached here rather than by an interceptor, because it has to happen on the way OUT of
      // this class and nothing above it knows a cookie exists. The browser does this itself; see
      // BrowserCookies.
      final request = options.compose(_dio.options, path, data: body);
      await _cookies.attach(request);
      options.headers = request.headers;
      response = await _dio.request<Object?>(
        path,
        data: body,
        options: options,
        onSendProgress: null,
      );
    } on DioException catch (e) {
      // No response at all: DNS, TLS, a dead proxy. Status 0 is what boot reads as "try again"
      // rather than "you are signed out" — the distinction that used to bounce people to /login.
      throw AuthError(e.message ?? 'network error', 0);
    }

    await _cookies.capture(response);

    final envelope = response.data;
    if (envelope is! Map<String, Object?>) {
      throw AuthError('HTTP ${response.statusCode}', response.statusCode ?? 0);
    }
    final status = response.statusCode ?? 0;
    if (status < 200 || status >= 300) {
      final message = envelope['message'];
      throw AuthError(message is String ? message : 'HTTP $status', status);
    }
    return envelope['data'] as T;
  }
}
