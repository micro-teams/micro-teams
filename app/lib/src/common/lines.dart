/// Which network paths this app may reach the backend over.
///
/// Today a deployment usually has exactly one, and it is the page's own origin — so every request
/// goes out byte for byte as it did before MultiPath existed. That is the whole point of adopting
/// it at this size: put the routing in place while the decision is still trivial, so that adding a
/// real second line later changes a registry and nothing else. The other order introduces the
/// plumbing and the risk on the same day.
///
/// Everything here is best-effort by design. The inline line is what the app was going to use
/// anyway, so a registry that never arrives costs nothing; a client that refused to start because
/// it could not fetch a routing table would have made the transport a startup dependency — exactly
/// backwards for the thing whose job is to survive one route being down.
library;

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:mt_api/mt_api.dart' as contract;
import 'package:multipath/multipath.dart';

import 'config.dart';

/// The line the app starts with: wherever it was already talking to.
///
/// Inline rather than fetched, because the registry is what tells the app where the backend is, and
/// fetching it first would mean asking the network where the network is.
Registry sameOriginOnly() =>
    const Registry([Line(id: 'origin', transport: 'same-origin', weight: 100)]);

/// Adopts the deployment's real registry, then starts measuring.
///
/// A registry that does not arrive leaves the same-origin line in place and says nothing: that is
/// the ordinary case on a cold start with no network, and warning about it every time is noise. A
/// registry that arrives and cannot be READ is a different thing and must not be silent — falling
/// back is still right, but it leaves the deployment believing multi-line is on while the client
/// quietly uses one line, which is invisible precisely while there is only one line to compare
/// against.
Future<void> adoptRegistry(
  LineManager manager,
  contract.TransportApi transport,
) async {
  try {
    final response = await transport.listLines();
    final lines = response.data?.lines ?? const <contract.Line>[];
    if (lines.isEmpty) return;
    // Round-tripped through MultiPath's own parser rather than mapped field by field. The generated
    // model says the document is well FORMED; parseRegistry says it is well formed AND usable —
    // ids unique, urls bare origins — which is the invariant every client in the org shares, and
    // the one place it is cheap to be wrong about.
    manager.registry = parseRegistry({
      'lines': [
        for (final line in lines)
          {
            'id': line.id,
            'url': line.url,
            'transport': line.transport,
            'weight': line.weight,
            'foreignOrigin': line.foreignOrigin,
          },
      ],
    });
  } on RegistryFormatException catch (error) {
    debugPrint(
      'MultiPath: ignoring the line registry, keeping one line: $error',
    );
  } catch (_) {
    // Offline, or no such endpoint on this deployment. Both are ordinary.
  }
}

/// The websocket URL for [path] over whichever line is carrying streams.
///
/// A stream cannot be raced — two connections are two conversations — so the most that is possible
/// is to pick the best line and, when it breaks, pick again. [StreamSelector] holds that memory
/// separately from request latency, because a proxy that serves requests perfectly may refuse the
/// Upgrade, and a line that cannot hold a stream is still a perfectly good line for requests.
String socketUrlOver(Line? line, Endpoints endpoints, String path) {
  final origin = line == null || line.url.isEmpty ? endpoints.origin : line.url;
  return endpoints.socketUrl(origin, path);
}

/// How this app sends one probe.
///
/// On its OWN client, not the app's. The app's client hangs five layers on every request, and one
/// of them picks a line: a probe sent through it would measure whichever line the router chose,
/// which is precisely the number a probe must not produce. The others would attach a token to a
/// public endpoint and record the answer in the read cache, neither of which a measurement wants.
///
/// What counts as an answer is decided here rather than by the library, deliberately: a 500 is a
/// perfectly prompt reply, and a probe that recorded it as a success would leave a broken line
/// ranked first.
SendProbe probeSender({required String origin}) {
  final client = Dio(BaseOptions(validateStatus: (_) => true));
  return (url) async {
    final target = url.startsWith('http') ? url : '$origin$url';
    final response = await client.getUri<List<int>>(
      Uri.parse(target),
      options: Options(responseType: ResponseType.bytes),
    );
    final status = response.statusCode ?? 0;
    return ProbeOutcome(
      ok: status >= 200 && status < 300,
      bytes: response.data?.length ?? 0,
    );
  };
}
