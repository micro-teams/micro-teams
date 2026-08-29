/// The other half of `flutter drive`: this runs on the machine, the test runs in the app.
///
/// It is boilerplate — everything interesting is in integration_test/. It exists because
/// `flutter drive` needs something to start on this side of the wire.
library;

import 'package:integration_test/integration_test_driver.dart';

Future<void> main() => integrationDriver();
