/// The other half of `flutter drive`: this runs on the machine, the journey runs in the app.
///
/// It would be one line — `integrationDriver()` — but for one thing this suite cannot give up: the
/// app and the server have to share an origin. Browsers treat a different port as a different site,
/// and this product is built on the opposite assumption; the backend refuses a cross-origin
/// `/mt/lines` outright, and the httpOnly refresh cookie would never be sent. So the browser must
/// load the app from the gateway, not from the server `flutter drive` starts for its own build.
///
/// `--web-launch-url` does that, but only in debug — and debug means dwds, whose channel was
/// unreliable here in every arrangement tried (see tool/e2e/run.sh). The way out is this file:
/// `FlutterDriver.connectWeb` takes the URL to open, so the run stays a release build (no dwds at
/// all) AND the browser still lands on the gateway.
///
///   MT_E2E_APP_URL   where the browser should go. Defaults to whatever `flutter drive` served,
///                    so running this by hand still behaves the way the tool expects.
library;

import 'dart:io';

import 'package:flutter_driver/flutter_driver.dart';
import 'package:integration_test/integration_test_driver_extended.dart';

Future<void> main() async {
  final url =
      Platform.environment['MT_E2E_APP_URL'] ??
      Platform.environment['VM_SERVICE_URL'];
  // `connect` is the web driver here — the tool sets FLUTTER_WEB_TEST — and its "dart VM service
  // url" is, for the web, simply the page to open.
  final driver = await FlutterDriver.connect(dartVmServiceUrl: url);
  await integrationDriver(driver: driver);
}
