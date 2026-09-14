// What a native client has to decide for itself.
//
// A web client is served by the deployment it belongs to, so it knows where it is and can be
// replaced at any moment. A native client is installed: nothing about it says which server it is
// for, and nothing replaces it. These are the two consequences.

import 'package:flutter_test/flutter_test.dart';
import 'package:microteams/src/common/build_info.dart';
import 'package:microteams/src/common/config.dart';

void main() {
  group('which server', () {
    test('a client with nothing saved starts at the default', () {
      // Not empty: an empty origin means "the page's own", and a native client has no page.
      expect(endpointsFor(saved: null).origin, defaultServer);
      expect(endpointsFor(saved: '  ').origin, defaultServer);
    });

    test('what was saved is what is used', () {
      expect(
        endpointsFor(saved: 'https://mt.example.com').origin,
        'https://mt.example.com',
      );
    });

    test('a trailing slash is not a different server', () {
      // Left alone it would put a double slash in every URL the app builds.
      expect(
        endpointsFor(saved: 'https://mt.example.com/').origin,
        'https://mt.example.com',
      );
    });
  });

  group('which generation', () {
    test('the family is x.y, and nothing else', () {
      expect(BuildInfo.familyOf('0.1.16-abc1234'), '0.1');
      expect(BuildInfo.familyOf('2.10.3-deadbee'), '2.10');
    });

    test('a patch is the same generation', () {
      // Shipping a fix must not lock out every installed client until they have all updated.
      expect(
        BuildInfo.familyOf('0.1.16-aaaaaaa'),
        BuildInfo.familyOf('0.1.99-bbbbbbb'),
      );
    });

    test('a minor bump is a different one', () {
      expect(
        BuildInfo.familyOf('0.1.16-aaaaaaa'),
        isNot(BuildInfo.familyOf('0.2.0-bbbbbbb')),
      );
    });

    test('an unstamped version is its own answer, not a crash', () {
      expect(BuildInfo.familyOf(''), '');
      expect(BuildInfo.familyOf('nonsense'), 'nonsense');
    });
  });
}
