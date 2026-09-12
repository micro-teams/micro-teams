/// The web half of [aWorkerCarriesRequests]. See worker_routes.dart for why this exists.
library;

/// Always true in a browser, and not because a worker is always there.
///
/// Because this isolate cannot hold a substrate at all. The MultiPath Dart client dials with
/// `dart:io`'s WebSocket, and dart2js compiles that import to a stub whose every call throws
/// `Unsupported operation` — so a browser build can reference it, which is why this compiles, and
/// can never use it, which is what matters. A page's substrate lives in the service worker or
/// nowhere.
///
/// It read `navigator.serviceWorker.controller != null` for one round, on the theory that a page
/// with no worker should carry its own. It cannot; all that produced was a dial that failed on every
/// request and a line panel reporting an absence that was never going to fill.
bool get aWorkerCarriesRequests => true;
