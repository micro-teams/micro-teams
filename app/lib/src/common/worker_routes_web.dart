/// The web half of [aWorkerCarriesRequests]. See worker_routes.dart for why this exists.
library;

import 'package:web/web.dart' as web;

/// True when a service worker is controlling this page.
///
/// `controller`, not `registration`: a worker that is registered but not yet in control does not see
/// this page's requests, and a page that stood down for it would be sending nothing over anything.
bool get aWorkerCarriesRequests =>
    web.window.navigator.serviceWorker.controller != null;
