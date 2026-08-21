/// Whether a URL is a real address.
///
/// Flutter web defaults to hash routing — `/#/chats/206` — which works but is not an address in
/// any sense that matters here: it cannot be linked to from outside, it looks like a fragment to
/// every tool that reads URLs, and it quietly contradicts what app.dart says this client does.
/// Turning it off needs nginx to answer unknown paths with index.html, which deploy/nginx.conf
/// already does (`try_files $uri $uri/ /index.html`).
library;

export 'url_strategy_stub.dart'
    if (dart.library.js_interop) 'url_strategy_web.dart';
