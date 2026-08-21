/// The web half of [signalReady]. See ready_signal.dart for why this exists at all.
library;

import 'package:web/web.dart' as web;

/// Marks the document as painted, for a browser test to read.
///
/// An attribute on `<html>` rather than a global: it survives whatever the engine does to the body,
/// it is visible in a screenshot of the DOM, and reading it needs no knowledge of Flutter's
/// internals — which is the point, since those change between versions and this check must not.
void signalReady() {
  web.document.documentElement?.setAttribute('data-mt-ready', '1');
}
