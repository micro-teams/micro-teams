/// Does a form hold what was typed into it, on this client?
///
/// Small on purpose: no backend, no gateway, no machine. It exists because the answer differs by
/// platform and the full journey costs twenty minutes to ask it once.
///
/// On Android the answer was no. `tester.enterText` focuses by setting `binding.focusedEditable`,
/// which starts a real, asynchronous `TextInput.attach`; the single frame it then waits is enough
/// for the web's synchronous fake and not for a device. The text lands on the previously attached
/// field, so a form fills one field behind and the LAST value ends up in the second-to-last box.
///
///   flutter drive --driver=test_driver/integration_test.dart \
///     --target=integration_test/form_probe_test.dart -d the-device
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

import 'support.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('a registration form holds what is typed into it', (
    tester,
  ) async {
    await startApp(tester);
    await tap(
      tester,
      find.text('no account? register'),
      what: 'the register link',
    );
    await waitFor(
      tester,
      find.byKey(const Key('register-username')),
      what: 'the register form',
    );

    // Four DISTINCT values, so a shift shows up as the wrong text rather than as a coincidence.
    final wanted = {
      Key('register-username'): 'probe-username',
      Key('register-password'): 'Probe-passw0rd!',
      Key('register-confirm'): 'Probe-passw0rd!',
      Key('register-email'): 'probe@example.com',
    };

    await fill(tester, wanted);

    for (final entry in wanted.entries) {
      final held = tester
          .widget<TextField>(find.byKey(entry.key).first)
          .controller
          ?.text;
      expect(
        held,
        entry.value,
        reason: '${entry.key} holds "$held" instead of "${entry.value}"',
      );
    }
    await note('the form held every value it was given');
  }, timeout: const Timeout(Duration(minutes: 4)));
}
