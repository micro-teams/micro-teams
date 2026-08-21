/// A mark on the document saying the app has painted.
///
/// Needed because Flutter draws into a canvas: there is no DOM to assert on, so "did the app
/// start?" has no answer a browser test can read — a `<canvas>` element exists whether or not
/// anything ever rendered into it. The React client could check that #root had children; this is
/// the replacement for that, and the only reason it exists.
///
/// It is set after the first frame, from inside the app, so it means what it says.
library;

export 'ready_signal_stub.dart'
    if (dart.library.js_interop) 'ready_signal_web.dart';
