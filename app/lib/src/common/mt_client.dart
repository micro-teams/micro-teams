/// The one configured client for the nt backend (teams / documents / chat / machines / agents).
///
/// The API surface itself is NOT written here: packages/mt_api is generated from the repo-root
/// MicroTeams-API.yml, the same contract the backend generates its Api interfaces from, so
/// `chat.listChats()` and the backend's ChatApi.listChats are two ends of one definition. This
/// file only supplies what the contract cannot: where the server is, who we are, and what an
/// error means.
///
/// One door in and one door out. Every request goes through this Dio, which means the bearer
/// token, the silent re-auth retry and the error translation are things a screen cannot forget to
/// do — because a screen never touches them. When the day comes to put requests on a chosen
/// network line (MultiPath, as the React client does), the line attaches here and nowhere else.
library;

import 'package:dio/dio.dart';
import 'package:mt_api/mt_api.dart';

import 'errors.dart';

/// Asked for a fresh access token after a 401. Returns null if the session is really over.
typedef Reauthorize = Future<String?> Function();

class MtClient {
  /// [adapter] replaces the transport. Tests pass a fake one so a controller can be driven against
  /// canned responses — the alternative is testing controllers against a live server, which is how
  /// a test suite ends up only covering the happy path.
  MtClient({
    required String baseUrl,
    required Reauthorize reauthorize,
    HttpClientAdapter? adapter,
  }) : _reauthorize = reauthorize,
       _dio = Dio(
         BaseOptions(
           baseUrl: baseUrl,
           // nt returns raw DTOs and serializes errors as {code, message, error}. Read the body
           // whatever the status, then translate — see the error interceptor below.
           validateStatus: (_) => true,
           extra: const {'withCredentials': true},
         ),
       ) {
    if (adapter != null) _dio.httpClientAdapter = adapter;
    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          final token = accessToken;
          if (token != null && token.isNotEmpty) {
            options.headers['Authorization'] = 'Bearer $token';
          }
          handler.next(options);
        },
        onResponse: (response, handler) async {
          final status = response.statusCode ?? 0;
          if (status >= 200 && status < 300) return handler.next(response);

          if (status == 401 &&
              response.requestOptions.extra['mt.retried'] != true) {
            final fresh = await _reauthorize();
            if (fresh != null && fresh.isNotEmpty) {
              accessToken = fresh;
              final options = response.requestOptions
                ..headers['Authorization'] = 'Bearer $fresh'
                ..extra['mt.retried'] = true;
              try {
                final retried = await _dio.fetch<Object?>(options);
                return handler.resolve(retried);
              } catch (_) {
                // fall through to the error below — a failed retry is still a failure
              }
            }
          }

          handler.reject(
            DioException(
              requestOptions: response.requestOptions,
              response: response,
              error: _translate(response),
              type: DioExceptionType.badResponse,
            ),
            true,
          );
        },
        onError: (error, handler) {
          if (error.error is MtError) return handler.next(error);
          // No response: the network, not the server. Status 0 so a screen can tell the two apart.
          handler.next(
            DioException(
              requestOptions: error.requestOptions,
              response: error.response,
              error: MtError(error.message ?? 'network error', 0),
              type: error.type,
            ),
          );
        },
      ),
    );
  }

  final Dio _dio;
  final Reauthorize _reauthorize;

  /// Kept in lockstep with the session by the auth layer, so a screen can call a typed API method
  /// without threading a token through every signature.
  String? accessToken;

  ChatApi get chat => ChatApi(_dio);
  TeamApi get team => TeamApi(_dio);
  MachineApi get machine => MachineApi(_dio);
  AgentApi get agent => AgentApi(_dio);
  TransportApi get transport => TransportApi(_dio);

  MtError _translate(Response<Object?> response) {
    final status = response.statusCode ?? 0;
    final body = response.data;
    if (body is Map<String, Object?>) {
      final message = body['message'];
      final code = body['code'];
      return MtError(
        message is String ? message : 'HTTP $status',
        status,
        code: code is num ? code.toInt() : null,
      );
    }
    return MtError('HTTP $status', status);
  }
}

/// Await this around any generated call so failures read the same everywhere.
///
/// The generated client throws DioException; the rest of the app only knows MtError, and shows the
/// sentence nt actually sent. Without this, a screen shows the user the word "DioException".
Future<T> mtCall<T>(Future<T> call) async {
  try {
    return await call;
  } on DioException catch (e) {
    final error = e.error;
    if (error is MtError) throw error;
    throw MtError(e.message ?? 'request failed', e.response?.statusCode ?? 0);
  }
}
