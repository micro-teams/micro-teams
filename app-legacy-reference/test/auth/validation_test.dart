// What the server will accept, asserted here so the form cannot start lying about it.
//
// These mirror cheese-auth's users.service.ts. The failure they exist to prevent is not a crash:
// it is a form that says a password is fine and then a server that refuses it, which teaches people
// not to trust the form.

import 'package:flutter_test/flutter_test.dart';
import 'package:microteams/src/auth/validation.dart';

void main() {
  group('username', () {
    test('accepts letters, digits, underscores and hyphens', () {
      expect(isValidUsername('probe_human-2'), isTrue);
    });

    test('refuses anything shorter than four', () {
      expect(isValidUsername('abc'), isFalse);
      expect(isValidUsername('abcd'), isTrue);
    });

    test('refuses anything longer than thirty-two', () {
      expect(isValidUsername('a' * 32), isTrue);
      expect(isValidUsername('a' * 33), isFalse);
    });

    test('refuses characters the server would refuse', () {
      for (final bad in ['has space', 'dots.are.out', 'slash/es', 'ünicode']) {
        expect(isValidUsername(bad), isFalse, reason: bad);
      }
    });
  });

  group('password', () {
    test('needs all four things at once', () {
      expect(isValidPassword('probe-pass-123'), isTrue);
    });

    test('reports which rule is missing rather than just "invalid"', () {
      final checks = PasswordChecks.of('alllettersonly');
      expect(checks.length, isTrue);
      expect(checks.letter, isTrue);
      expect(checks.digit, isFalse);
      expect(checks.special, isFalse);
      expect(checks.allMet, isFalse);
    });

    test('eight characters is enough, seven is not', () {
      expect(isValidPassword('aB3!efgh'), isTrue);
      expect(isValidPassword('aB3!efg'), isFalse);
    });

    test('accepts the punctuation the server calls special', () {
      // The server's range is printable ASCII punctuation. Getting this narrower than the server's
      // would reject passwords it would have accepted — a rejection nobody can explain.
      for (final special in ['!', '/', ':', '@', '[', '`', '{', '~']) {
        expect(
          isValidPassword('abcd1234$special'),
          isTrue,
          reason: 'rejected "$special"',
        );
      }
    });

    test('does not count a letter or a digit as special', () {
      expect(isValidPassword('abcd1234'), isFalse);
    });
  });
}
