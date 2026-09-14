/// Which network paths this app may reach the backend over.
///
/// Today a deployment usually has exactly one, and it is the page's own origin — so everything goes
/// out byte for byte as it did before MultiPath existed. That is the whole point of adopting it at
/// this size: put the transport in place while the decision is still trivial, so that adding a real
/// second line later changes a registry and nothing else. The other order introduces the plumbing
/// and the risk on the same day.
///
/// What this file no longer does is measure. Probing, ranking and "which line is fastest" were the
/// answers to a question 0.2.0 deleted: the substrate writes every byte to every line and delivers
/// whichever copy arrives first, so a slow line costs nothing and a dead one is simply never the one
/// an answer comes from. A measurement would be a number nobody could act on.
///
/// Everything here is best-effort by design. The starting line is what the app was going to use
/// anyway, so a registry that never arrives costs nothing; a client that refused to start because it
/// could not fetch a routing table would have made the transport a startup dependency — exactly
/// backwards for the thing whose job is to survive one route being down.
library;

import 'package:flutter/foundation.dart';
import 'package:mt_api/mt_api.dart' as contract;

/// The line the app starts with: wherever it was already talking to.
///
/// Inline rather than fetched, because the registry is what tells the app where the backend is, and
/// fetching it first would mean asking the network where the network is.
List<String> sameOriginOnly(String origin) =>
    origin.isEmpty ? const [] : [origin];

/// Asks the deployment which lines exist.
///
/// Returns the origins to carry the substrate over, [fallback] when there is nothing usable to
/// adopt. A registry that does not arrive is the ordinary case on a cold start with no network and
/// says nothing; a registry that arrives and cannot be read is a different thing and must not be
/// silent — falling back is still right, but it leaves the deployment believing multi-line is on
/// while the client quietly uses one line, which is invisible precisely while there is only one line
/// to compare against.
Future<List<String>> fetchLines(
  contract.TransportApi transport, {
  required String fallback,
}) async {
  final start = sameOriginOnly(fallback);
  try {
    final response = await transport.listLines();
    final lines = response.data?.lines ?? const <contract.Line>[];
    if (lines.isEmpty) return start;

    final out = <String>[];
    for (final line in lines) {
      // An empty url means "wherever this client already reaches the server", which only this
      // process can turn into an address. A link is dialled AT a URL, so an entry that cannot become
      // one is not a line.
      final url = line.url.isEmpty ? fallback : line.url;
      if (url.isEmpty) continue;
      out.add(url);
    }
    if (out.isEmpty) {
      debugPrint('MultiPath: the registry named no usable line, keeping one');
      return start;
    }
    return out;
  } catch (_) {
    // Offline, or no such endpoint on this deployment. Both are ordinary.
    return start;
  }
}
