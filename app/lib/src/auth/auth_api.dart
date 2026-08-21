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

import 'package:dio/dio.dart';

import '../common/errors.dart';

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
}

class BrowserCookies extends CookieHolder {
  const BrowserCookies();

  @override
  Future<void> attach(RequestOptions options) async {}

  @override
  Future<void> capture(Response<Object?> response) async {}
}

class AuthApi {
  AuthApi({
    required String baseUrl,
    CookieHolder cookies = const BrowserCookies(),
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
       );

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

  Future<void> logout() async {
    await _post<Object?>('/users/auth/logout', const {});
  }

  Future<AuthUser> me(String accessToken) async {
    final data = await _request<Map<String, Object?>>(
      '/users/me',
      method: 'GET',
      accessToken: accessToken,
    );
    return AuthUser.fromJson(data['user']! as Map<String, Object?>);
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
