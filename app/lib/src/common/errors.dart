/// One error type per backend, so a screen never has to know which client threw.
///
/// The React app learned this the hard way: the generated client throws its own transport error
/// holding a raw response, and every caller that forgot to translate it showed the user
/// "ResponseError" instead of the sentence the server actually sent. Here the translation happens
/// in the interceptor (see mt/client.dart), and nothing above it ever sees a Dio exception.
library;

import 'package:dio/dio.dart';

class AuthError implements Exception {
  AuthError(this.message, this.status);

  final String message;
  final int status;

  /// A real "you are not signed in", as opposed to a blip. Boot uses this to decide whether to
  /// drop someone to the login screen or to try again — the distinction that used to bounce a
  /// signed-in user out on a reload during a network hiccup.
  bool get isUnauthenticated => status == 401;

  bool get isTransient => status == 0 || status >= 500;

  @override
  String toString() => message;
}

/// What nt refused, as the thing that is actually thrown.
///
/// It extends [DioException] rather than merely being carried inside one, and that is the whole
/// reason the app no longer wraps every call in an `mtCall(...)`. Dio wraps anything an interceptor
/// rejects with, so a plain exception could only ever arrive as `DioException.error` — and every
/// caller that forgot to unwrap it showed the user the word "DioException". Being one removes the
/// step instead of asking people to remember it.
class MtError extends DioException {
  MtError(String message, this.status, {this.code, RequestOptions? request})
    : super(
        requestOptions: request ?? RequestOptions(),
        message: message,
        type: DioExceptionType.badResponse,
      );

  /// Narrowed from `String?`: there is always something to show, and a screen that had to handle a
  /// null message would end up printing "null" the one time it mattered.
  @override
  String get message => super.message!;
  final int status;
  final int? code;

  bool get isUnauthorized => status == 401;
  bool get isForbidden => status == 403;
  bool get isNotFound => status == 404;

  @override
  String toString() => message;
}
