/// Where the two backends are.
///
/// On the web these stay relative, exactly as the React client has them: the page's own origin
/// proxies /api to cheese-auth and /mt to nt, which is what lets the httpOnly REFRESH_TOKEN
/// cookie ride along without a word of CORS configuration.
///
/// On a native build there is no proxy and no origin, so [origin] has to be told. That is the
/// single difference between the two worlds, and keeping it to one place is deliberate: every
/// other layer above this file is allowed to assume it just has a base URL.
library;

import 'package:flutter/foundation.dart';

import 'build_info.dart';

class Endpoints {
  const Endpoints({required this.origin});

  /// Empty on the web (same-origin, relative paths). A full `https://host[:port]` elsewhere.
  final String origin;

  /// This deployment's address, spelled out in full.
  ///
  /// [origin] is empty on the web on purpose — every request the app makes is relative, which is
  /// what keeps it on whatever host served it. But some strings LEAVE the browser: the command that
  /// installs a connector on somebody's laptop cannot say `curl /install.sh`. Those need the
  /// absolute address, and on the web the only honest source for it is the page's own URL.
  ///
  /// One place, so the answer to "where is this deployment?" is not inferred twice. When a native
  /// client eventually asks for a server at sign-in, that answer lands here too and nothing else
  /// changes.
  String get publicOrigin => origin.isEmpty ? _pageOrigin() : origin;

  /// cheese-auth: users, login, refresh, avatars. Envelope responses.
  String get auth => '$origin/api';

  /// nt: teams, chats, machines, agents. Raw DTOs, bearer auth.
  String get mt => '$origin/mt';

  /// A websocket URL under [over], which is a line's origin — or this app's own when the line is
  /// same-origin, or when there is no line manager yet.
  ///
  /// Streams are the one thing MultiPath cannot race, so which line carries them is a decision made
  /// once per connection and remade on every reconnect. Taking the origin as an argument is what
  /// lets that decision live in the socket rather than here.
  String socketUrl(String over, String path) {
    final base = over.isEmpty
        ? _pageOriginAsWebSocket()
        : over.replaceFirst(RegExp('^http'), 'ws');
    return '$base$path';
  }

  /// The updates socket. ws:// or wss:// derived from the origin — on the web from the page's.
  String updatesSocket(String? token) {
    final query = token == null || token.isEmpty
        ? ''
        : '?token=${Uri.encodeComponent(token)}';
    return socketUrl(origin, '/mt/updates$query');
  }

  /// A viewer connection for one live screen. Same reasoning as [updatesSocket].
  ///
  /// The path mirrors MachineWebSocketConfig's `/machine/screen/*` mapping. The screen id is a
  /// string, not a number: it is the session id the connector chose.
  String screenSocket(String sessionId, String? token) =>
      socketUrl(origin, screenPath(sessionId, token));

  /// The path alone, for a caller that is choosing the host itself — which is what routing a stream
  /// over a line means.
  String screenPath(String sessionId, String? token) {
    final query = token == null || token.isEmpty
        ? ''
        : '?token=${Uri.encodeComponent(token)}';
    return '/mt/machine/screen/${Uri.encodeComponent(sessionId)}$query';
  }
}

/// Where this page came from. Only reachable on the web, where `Uri.base` is the page URL.
String _pageOrigin() {
  final page = Uri.base;
  return '${page.scheme}://${page.authority}';
}

String _pageOriginAsWebSocket() {
  // Only reachable on the web build, where Uri.base is the page URL.
  final page = Uri.base;
  final scheme = page.scheme == 'https' ? 'wss' : 'ws';
  return '$scheme://${page.authority}';
}

/// Where a native client remembers which server it was told to use.
const String serverSetting = 'server';

/// The endpoints this run should use.
///
/// On the web there is nothing to decide: the page came from somewhere, and that somewhere is the
/// server. A native client has no such luck — it was installed, not served — so it asks at sign-in
/// and remembers the answer. [saved] is that answer; [defaultServer] is what the field starts with.
///
/// `MT_ORIGIN` still wins where it is set, because a build made for one deployment should not have
/// to be told at first run which deployment it is for.
Endpoints endpointsFor({String? saved}) {
  const configured = String.fromEnvironment('MT_ORIGIN');
  if (configured.isNotEmpty) return Endpoints(origin: configured);
  if (kIsWeb) return const Endpoints(origin: '');
  final chosen = (saved ?? '').trim();
  return Endpoints(
    origin: chosen.isEmpty ? defaultServer : trimTrailingSlash(chosen),
  );
}

/// `https://host/` and `https://host` are the same server said two ways, and one of them makes
/// every URL in the app contain a double slash.
String trimTrailingSlash(String origin) =>
    origin.endsWith('/') ? origin.substring(0, origin.length - 1) : origin;
