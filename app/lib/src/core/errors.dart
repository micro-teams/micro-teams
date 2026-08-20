/// One error type per backend, so a screen never has to know which client threw.
///
/// The React app learned this the hard way: the generated client throws its own transport error
/// holding a raw response, and every caller that forgot to translate it showed the user
/// "ResponseError" instead of the sentence the server actually sent. Here the translation happens
/// in the interceptor (see mt/client.dart), and nothing above it ever sees a Dio exception.
library;

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

class MtError implements Exception {
  MtError(this.message, this.status, {this.code});

  final String message;
  final int status;
  final int? code;

  bool get isUnauthorized => status == 401;
  bool get isForbidden => status == 403;
  bool get isNotFound => status == 404;

  @override
  String toString() => message;
}
