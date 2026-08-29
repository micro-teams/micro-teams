/// The first vertical slice of the end-to-end suite: a person who has never been here before signs
/// up, starts a conversation, and says something — and every step of it goes through the interface
/// the way a person would, against a real deployment.
///
/// Why this exists at all, and why it is written in Dart rather than driven from outside: Flutter
/// paints into a canvas, so a browser-driven harness (our old Playwright checks) can only see
/// traffic, URLs and screenshots. It cannot see which side a bubble is on, or what a menu says. A
/// test that runs INSIDE the app process can see the widget tree AND talks to a real server, which
/// is the only combination that lets a widget test be deleted rather than merely duplicated.
///
/// The shape is deliberate (see todo/microteams/testing-e2e.md): parameters go in, results come
/// out, and nothing outside directs the run. Everything this journey needs, it makes for itself —
/// starting with its own account — so any number of these can run in parallel, on different
/// clients, against the same deployment, without agreeing on anything.
///
/// Parameters (all --dart-define):
///   MT_ORIGIN      the deployment under test. Also what the app itself talks to.
///   MT_E2E_MAIL    base URL of tool/e2e/mailsink.py, which catches the sign-up code.
///   MT_E2E_RUN     a token unique to this run; every name this test invents contains it.
library;

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:microteams/main.dart' as app;

/// Where the mail sink can be reached FROM THE BROWSER. It is proxied onto this origin by the
/// gateway (`/mail/...`), so the test asks nobody for permission: a cross-origin fetch here would
/// bring CORS into a test that has nothing to do with CORS.
const _mailBase = String.fromEnvironment('MT_E2E_MAIL', defaultValue: '/mail');
const _run = String.fromEnvironment('MT_E2E_RUN');

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('a new person signs up, starts a chat, and is heard', (
    tester,
  ) async {
    expect(_mailBase, isNotEmpty, reason: 'MT_E2E_MAIL was not passed in');
    expect(_run, isNotEmpty, reason: 'MT_E2E_RUN was not passed in');

    final username = 'e2e$_run';
    final email = '$username@example.com';
    const password = 'E2e-passw0rd!';

    // With a deadline: an unbounded await here is the one failure this harness cannot report —
    // the run just sits there until something outside kills it, and the log says nothing at all.
    await app.main().timeout(
      const Duration(seconds: 60),
      onTimeout: () => fail('the app did not finish booting within 60s'),
    );
    await _settle(tester);

    // --- sign up ------------------------------------------------------------------------------
    await _tap(tester, find.text('no account? register'), what: 'the register link');
    await _waitFor(tester, find.byKey(const Key('register-username')), what: 'the register form');

    await _type(tester, const Key('register-username'), username);
    await _type(tester, const Key('register-password'), password);
    await _type(tester, const Key('register-confirm'), password);
    await _type(tester, const Key('register-email'), email);

    // The code is mailed, so the test reads the mail. Asking the database instead would assert
    // against our own storage rather than against what a person actually receives — and would walk
    // straight past a deployment whose SMTP is misconfigured, which is the single most common way
    // sign-up is dead on a fresh install.
    await _tap(tester, find.text('send code'), what: 'the send-code button');
    await _waitFor(tester, find.text('a code is on its way to that address'), what: 'confirmation that the code was sent');
    final code = await _codeFromMail(tester, email);
    await _type(tester, const Key('register-code'), code);

    await _tap(tester, find.text('create account'), what: 'the create-account button');

    // Landing on the chats list is how the app says the session is real: the router only lets a
    // signed-in tree exist.
    await _waitFor(tester, find.byIcon(Icons.add_comment_outlined), what: 'the chats list (proof the session is real)');

    // --- start a conversation -------------------------------------------------------------------
    final title = 'journey $_run';
    await _tap(tester, find.byIcon(Icons.add_comment_outlined), what: 'the new-chat button');
    await _waitFor(tester, find.text('New chat'), what: 'the New chat dialog');
    await tester.enterText(find.widgetWithText(TextField, 'Title'), title);
    await tester.pump();
    await _tap(tester, find.widgetWithText(FilledButton, 'Create'), what: 'the New chat dialog\'s Create');

    // --- say something ---------------------------------------------------------------------------
    await _waitFor(tester, find.widgetWithText(TextField, 'message…'), what: 'the composer');
    final said = 'hello from $_run';
    await tester.enterText(find.widgetWithText(TextField, 'message…'), said);
    await tester.pump();
    await _tap(tester, find.widgetWithText(FilledButton, 'send'), what: 'the send button');

    // The bubble alone proves nothing: it is painted optimistically the instant the send button is
    // pressed, and it would look exactly the same if the request never left. What proves the
    // message is on the server is the 'sending…' clock going away — the outbox only drops that
    // when the stored message comes back with an id.
    await _waitFor(tester, find.text(said), what: 'the message bubble');
    await _waitUntilGone(
      tester,
      find.byIcon(Icons.schedule),
      what: 'the sending… clock',
    );

    // Then leave the thread and come back, so the messages are read again rather than remembered.
    // How you leave depends on the shape of the window: a phone stacks the thread over the list and
    // offers a back button, a desktop shows both at once and has none. The journey has to work on
    // whatever client it was handed, so it asks rather than assumes.
    if (find.byTooltip('Back').evaluate().isNotEmpty) {
      await _tap(tester, find.byTooltip('Back'), what: 'the back button');
      await _waitFor(tester, find.text(title), what: 'the thread back in the list');
    }
    await _tap(tester, find.text(title), what: 'the thread in the list');
    await _waitFor(tester, find.text(said), what: 'the message, read back');
  }, timeout: const Timeout(Duration(minutes: 6)));
}

/// Pump until [finder] matches, or give up loudly.
///
/// `pumpAndSettle` is the wrong tool against a live server: this app always has something animating
/// or in flight, so it either throws or waits for a quiet frame that never comes. Stepping the clock
/// by hand and checking is the only thing that works here.
Future<void> _waitFor(
  WidgetTester tester,
  Finder finder, {
  String? what,
  Duration limit = const Duration(seconds: 60),
}) async {
  // Note the finder is used as given: a `.first` finder throws rather than reporting empty when
  // nothing matches, which turns "not there yet" into a crash. Narrowing happens at the tap.
  debugPrint('journey: waiting for ${what ?? finder}');
  final deadline = DateTime.now().add(limit);
  while (DateTime.now().isBefore(deadline)) {
    await tester.pump(const Duration(milliseconds: 100));
    if (finder.evaluate().isNotEmpty) return;
  }
  fail('waited ${limit.inSeconds}s for ${what ?? finder} and it never appeared');
}

/// The other half of [_waitFor]: pump until [finder] stops matching.
Future<void> _waitUntilGone(
  WidgetTester tester,
  Finder finder, {
  String? what,
  Duration limit = const Duration(seconds: 60),
}) async {
  debugPrint('journey: waiting for ${what ?? finder} to go away');
  final deadline = DateTime.now().add(limit);
  while (DateTime.now().isBefore(deadline)) {
    await tester.pump(const Duration(milliseconds: 100));
    if (finder.evaluate().isEmpty) return;
  }
  fail('waited ${limit.inSeconds}s for ${what ?? finder} to go away');
}

Future<void> _settle(WidgetTester tester) async {
  for (var i = 0; i < 20; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

Future<void> _tap(WidgetTester tester, Finder finder, {String? what}) async {
  await _waitFor(tester, finder, what: what);
  await tester.tap(finder.first);
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 100));
}

Future<void> _type(WidgetTester tester, Key key, String text) async {
  await _waitFor(tester, find.byKey(key));
  await tester.enterText(find.byKey(key), text);
  await tester.pump();
}

/// Poll the mail sink until the sign-up code for [email] shows up.
Future<String> _codeFromMail(WidgetTester tester, String email) async {
  final dio = Dio(
    BaseOptions(
      responseType: ResponseType.json,
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 10),
    ),
  );
  final deadline = DateTime.now().add(const Duration(seconds: 60));
  while (DateTime.now().isBefore(deadline)) {
    final response = await dio.get<List<Object?>>(
      '$_mailBase/messages',
      queryParameters: {'to': email},
    );
    for (final message in response.data ?? const <Object?>[]) {
      final body = (message! as Map)['body'] as String? ?? '';
      final match = RegExp(r'code is:\s*(\d{4,8})').firstMatch(body);
      if (match != null) return match.group(1)!;
    }
    await tester.pump(const Duration(milliseconds: 500));
  }
  fail('no sign-up code was mailed to $email within 60s');
}
