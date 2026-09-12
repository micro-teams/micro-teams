/// Whether a service worker is in front of this page, carrying its requests.
///
/// The web build has two places the substrate can live and must have exactly one: the service
/// worker, which is in front of the whole document, or this isolate's own HTTP client. Both at once
/// would be two redundant transports opening two sets of links to every line to do one job.
///
/// So the answer is "the worker, if there is one controlling this page". There is not always: the
/// very first visit runs before the worker has taken over, a browser may have workers disabled, and
/// a driven browser test deliberately serves no worker at all. In all of those the page has to carry
/// its own transport or it silently has no redundancy — which is the state this layer exists to make
/// impossible to be in unknowingly.
library;

export 'worker_routes_stub.dart'
    if (dart.library.js_interop) 'worker_routes_web.dart';
