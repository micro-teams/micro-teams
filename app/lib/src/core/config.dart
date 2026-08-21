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

class Endpoints {
  const Endpoints({required this.origin});

  /// Empty on the web (same-origin, relative paths). A full `https://host[:port]` elsewhere.
  final String origin;

  /// cheese-auth: users, login, refresh, avatars. Envelope responses.
  String get auth => '$origin/api';

  /// nt: teams, chats, machines, agents. Raw DTOs, bearer auth.
  String get mt => '$origin/mt';

  /// The updates socket. ws:// or wss:// derived from the origin — on the web from the page's.
  String updatesSocket(String? token) {
    final base = origin.isEmpty
        ? _pageOriginAsWebSocket()
        : origin.replaceFirst(RegExp('^http'), 'ws');
    final query = token == null || token.isEmpty
        ? ''
        : '?token=${Uri.encodeComponent(token)}';
    return '$base/mt/updates$query';
  }

  /// A viewer connection for one live screen. Same reasoning as [updatesSocket].
  ///
  /// The path mirrors MachineWebSocketConfig's `/machine/screen/*` mapping. The screen id is a
  /// string, not a number: it is the session id the connector chose.
  String screenSocket(String sessionId, String? token) {
    final base = origin.isEmpty
        ? _pageOriginAsWebSocket()
        : origin.replaceFirst(RegExp('^http'), 'ws');
    final query = token == null || token.isEmpty
        ? ''
        : '?token=${Uri.encodeComponent(token)}';
    return '$base/mt/machine/screen/${Uri.encodeComponent(sessionId)}$query';
  }
}

String _pageOriginAsWebSocket() {
  // Only reachable on the web build, where Uri.base is the page URL.
  final page = Uri.base;
  final scheme = page.scheme == 'https' ? 'wss' : 'ws';
  return '$scheme://${page.authority}';
}

/// The default for the build being run.
///
/// Native builds override it with `--dart-define=MT_ORIGIN=https://…`; there is no baked-in
/// hostname anywhere in this repo, and there should never be one.
Endpoints defaultEndpoints() {
  const configured = String.fromEnvironment('MT_ORIGIN');
  if (configured.isNotEmpty) return Endpoints(origin: configured);
  if (kIsWeb) return const Endpoints(origin: '');
  throw StateError(
    'A native build has no origin to talk to. Pass --dart-define=MT_ORIGIN=https://your-host '
    'at build time.',
  );
}
