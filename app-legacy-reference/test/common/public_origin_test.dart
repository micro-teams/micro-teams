// Where this deployment is, spelled out — for the strings that leave the browser.

import 'package:flutter_test/flutter_test.dart';
import 'package:microteams/src/common/config.dart';

void main() {
  test('a configured origin is used as it is', () {
    const endpoints = Endpoints(origin: 'https://mt.example');
    expect(endpoints.publicOrigin, 'https://mt.example');
  });

  test('an empty origin falls back to where the page came from', () {
    // Empty is the web's case, and on purpose: every request the app makes is relative, which is
    // what keeps it on whatever host served it. An install command cannot be relative.
    const endpoints = Endpoints(origin: '');
    expect(endpoints.publicOrigin, isNot(''));
    expect(
      endpoints.publicOrigin,
      startsWith('${Uri.base.scheme}://'),
      reason: 'the page it is running in is the only honest source',
    );
    expect(
      endpoints.publicOrigin,
      isNot(contains('microteams.app')),
      reason: 'no deployment hostname is baked in anywhere in this repo',
    );
  });
}
