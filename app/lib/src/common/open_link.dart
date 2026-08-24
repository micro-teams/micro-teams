/// Opening an address outside the app.
///
/// One line of platform difference, kept behind a conditional import for the same reason
/// ready_signal.dart is: the alternative is `if (kIsWeb)` at the call site plus an import that only
/// compiles on one of the two platforms.
library;

export 'open_link_stub.dart' if (dart.library.js_interop) 'open_link_web.dart';
