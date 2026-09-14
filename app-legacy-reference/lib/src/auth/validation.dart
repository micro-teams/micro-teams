/// What cheese-auth will accept, said here so the form can say it first.
///
/// These mirror the server's `users.service.ts` — `isValidUsername` /
/// `isValidPassword` and their rule strings — read from that source rather than guessed. A client
/// that guesses at the server's rules tells people their password is fine and then fails on submit,
/// which is worse than no client-side checking at all: it teaches them not to trust the form.
///
/// The React client carried the same two regexes for the same reason. If the server's rules change,
/// these are what has to change with them, and there is exactly one place to look.
library;

final RegExp usernamePattern = RegExp(r'^[a-zA-Z0-9_-]{4,32}$');

const String usernameRule =
    'Username must be 4-32 characters long and can only contain letters, '
    'numbers, underscores and hyphens.';

final RegExp _letter = RegExp('[a-zA-Z]');
final RegExp _digit = RegExp(r'\d');

/// Printable ASCII punctuation — the server's `\x21-\x2F\x3A-\x40\x5B-\x60\x7B-\x7E`.
final RegExp _special = RegExp(r'[!-/:-@\[-`{-~]');

const String passwordRule =
    'Password must be at least 8 characters long and must contain at least '
    'one letter, one digit, and one special character.';

/// Which of the password's four requirements are met.
///
/// Reported as four separate answers rather than one boolean, because the useful thing to show
/// someone is which rule they have not met yet — a form that says only "invalid password" makes
/// them guess.
class PasswordChecks {
  const PasswordChecks({
    required this.length,
    required this.letter,
    required this.digit,
    required this.special,
  });

  factory PasswordChecks.of(String password) => PasswordChecks(
    length: password.length >= 8,
    letter: _letter.hasMatch(password),
    digit: _digit.hasMatch(password),
    special: _special.hasMatch(password),
  );

  final bool length;
  final bool letter;
  final bool digit;
  final bool special;

  bool get allMet => length && letter && digit && special;

  /// Each rule with whether it is satisfied, in the order they are shown.
  List<({String label, bool met})> get rules => [
    (label: 'at least 8 characters', met: length),
    (label: 'a letter', met: letter),
    (label: 'a digit', met: digit),
    (label: 'a special character', met: special),
  ];
}

bool isValidUsername(String username) => usernamePattern.hasMatch(username);

bool isValidPassword(String password) => PasswordChecks.of(password).allMet;
