/// What every journey needs and no journey should own.
///
/// Two kinds of thing live here: the waiting primitives (a live server makes `pumpAndSettle` the
/// wrong tool — see [waitFor]), and the steps every journey starts with, above all making its own
/// account. A journey that borrows an account from another journey cannot run beside it, and
/// running beside each other is the whole point of the shape (see todo/microteams/testing-e2e.md).
library;

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:microteams/main.dart' as app;

/// Where the mail sink can be reached FROM THE BROWSER. The gateway puts it on this origin, so the
/// test asks nobody for permission: a cross-origin fetch would drag CORS into a test about
/// something else entirely.
const mailBase = String.fromEnvironment('MT_E2E_MAIL', defaultValue: '/mail');

/// A token unique to this run. Every name a journey invents contains it, which is what lets any
/// number of journeys share one deployment.
const runId = String.fromEnvironment('MT_E2E_RUN');

/// Meets the four rules the register form checks, and never needs to change with them.
const password = 'E2e-passw0rd!';

/// Say where the journey has got to.
///
/// A release web build reports a failed expectation as one line — the test's name — and nothing
/// else, so without this a red run says only that the journey failed, never where. The note goes to
/// the mail sink, which the harness reads back when something goes wrong. Failures to send are
/// swallowed on purpose: a trace that can break the run it is tracing is worse than no trace.
Future<void> note(String what) async {
  try {
    await Dio(
      BaseOptions(
        connectTimeout: const Duration(seconds: 5),
        receiveTimeout: const Duration(seconds: 5),
      ),
    ).get<Object?>('$mailBase/note', queryParameters: {'text': what});
  } catch (_) {}
}

/// Everything the screen is saying right now, into the trace.
///
/// The one question worth asking when a wait times out — an error under the form, an empty list, a
/// screen that is not the one expected — and on a canvas there is no other way to ask it.
Future<void> noteScreen() async {
  final texts = find
      .byType(Text)
      .evaluate()
      .map((element) => (element.widget as Text).data)
      .whereType<String>()
      .where((line) => line.trim().isNotEmpty)
      .toList();
  await note('  the screen says: ${texts.join(' | ')}');
  final buttons = find
      .byType(ButtonStyleButton)
      .evaluate()
      .map((element) => element.widget as ButtonStyleButton)
      .map(
        (button) =>
            '${button.child is Text ? (button.child! as Text).data : button.child.runtimeType}'
            '${button.onPressed == null ? ' (disabled)' : ''}',
      )
      .toList();
  await note('  the buttons are: ${buttons.join(' | ')}');
}

/// Boot the app, with a deadline.
///
/// An unbounded await here is the one failure this harness cannot report: the run just sits there
/// until something outside kills it, and the log says nothing at all.
Future<void> startApp(WidgetTester tester) async {
  await note('booting the app');
  await app.main().timeout(
    const Duration(seconds: 60),
    onTimeout: () => fail('the app did not finish booting within 60s'),
  );
  for (var i = 0; i < 20; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

/// Make an account the way a person would, including reading the code out of the mail.
///
/// Asking the database for the code instead would assert against our own storage rather than
/// against what a person actually receives — and would walk straight past a deployment whose SMTP
/// is misconfigured, which is the most common way sign-up is dead on a fresh install.
///
/// Returns the username, since journeys name things after themselves.
Future<String> signUp(WidgetTester tester, {String suffix = ''}) async {
  final username = 'e2e$runId$suffix';
  final email = '$username@example.com';

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

  await type(tester, const Key('register-username'), username);
  await type(tester, const Key('register-password'), password);
  await type(tester, const Key('register-confirm'), password);
  await type(tester, const Key('register-email'), email);

  await tap(tester, find.text('send code'), what: 'the send-code button');
  await waitFor(
    tester,
    find.text('a code is on its way to that address'),
    what: 'confirmation that the code was sent',
  );
  await type(
    tester,
    const Key('register-code'),
    await codeFromMail(tester, email),
  );
  await tap(
    tester,
    find.text('create account'),
    what: 'the create-account button',
  );

  // Landing on the chats list is how the app says the session is real: the router only lets a
  // signed-in tree exist.
  await waitFor(
    tester,
    find.byIcon(Icons.add_comment_outlined),
    what: 'the chats list (proof the session is real)',
  );
  return username;
}

/// Pump until [finder] matches, or give up loudly.
///
/// `pumpAndSettle` is the wrong tool against a live server: this app always has something animating
/// or in flight, so it either throws or waits for a quiet frame that never comes. Stepping the clock
/// by hand and checking is the only thing that works here.
///
/// The finder is used as given. A `.first` finder throws rather than reporting empty when nothing
/// matches, which turns "not there yet" into a crash — so narrowing happens at the tap.
Future<void> waitFor(
  WidgetTester tester,
  Finder finder, {
  String? what,
  Duration limit = const Duration(seconds: 60),
}) async {
  await note('waiting for ${what ?? finder}');
  final deadline = DateTime.now().add(limit);
  while (DateTime.now().isBefore(deadline)) {
    await tester.pump(const Duration(milliseconds: 100));
    if (finder.evaluate().isNotEmpty) {
      await note('  found ${what ?? finder}');
      return;
    }
  }
  await note('  GAVE UP on ${what ?? finder}');
  await noteScreen();
  fail(
    'waited ${limit.inSeconds}s for ${what ?? finder} and it never appeared',
  );
}

/// The other half of [waitFor]: pump until [finder] stops matching.
Future<void> waitUntilGone(
  WidgetTester tester,
  Finder finder, {
  String? what,
  Duration limit = const Duration(seconds: 60),
}) async {
  await note('waiting for ${what ?? finder} to go away');
  final deadline = DateTime.now().add(limit);
  while (DateTime.now().isBefore(deadline)) {
    await tester.pump(const Duration(milliseconds: 100));
    if (finder.evaluate().isEmpty) {
      await note('  gone: ${what ?? finder}');
      return;
    }
  }
  await note('  GAVE UP waiting for ${what ?? finder} to go away');
  await noteScreen();
  fail('waited ${limit.inSeconds}s for ${what ?? finder} to go away');
}

Future<void> tap(WidgetTester tester, Finder finder, {String? what}) async {
  await waitFor(tester, finder, what: what);
  await tester.tap(finder.first);
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 100));
}

/// [type] by any finder, not just by key.
Future<void> typeInto(WidgetTester tester, Finder finder, String text) async {
  await waitFor(tester, finder, what: 'a field to type "$text" into');
  await tester.tap(finder.first);
  await tester.pump(const Duration(milliseconds: 100));
  tester.testTextInput.enterText(text);
  await tester.pump(const Duration(milliseconds: 100));
  if (tester.widget<TextField>(finder.first).controller?.text != text) {
    await tester.enterText(finder.first, text);
    await tester.pump(const Duration(milliseconds: 100));
  }
  final got = tester.widget<TextField>(finder.first).controller?.text ?? '';
  if (got != text) {
    await note('  typing "$text" did not stick: the field holds "$got"');
    fail('could not type "$text" — the field holds "$got"');
  }
}

/// Type into a field the way a person does: focus it, then send the text.
///
/// `enterText` alone is not enough here. It works in a widget test and in a debug build, and in a
/// RELEASE web build it quietly does nothing — the field stays empty, the submit button never
/// enables, and the journey waits for something that will never happen. Tapping first gives the
/// field a real focus, and the text then goes through the same input channel the platform uses.
///
/// The read-back is not belt and braces: it is the only way this failure is visible at all.
/// Tap, and keep tapping until it took.
///
/// A list that is still settling can swallow the first tap — the row is drawn, the finder finds it,
/// and the tap lands on something that is about to be replaced. Retrying is honest here in a way
/// that retrying an assertion never is: the question being asked is "did this tap do anything",
/// and the answer is checked, not assumed.
Future<void> tapUntil(
  WidgetTester tester,
  Finder finder,
  Finder until, {
  String? what,
  String? expecting,
  int tries = 3,
}) async {
  for (var attempt = 1; attempt <= tries; attempt++) {
    await tap(tester, finder, what: what);
    final deadline = DateTime.now().add(const Duration(seconds: 10));
    while (DateTime.now().isBefore(deadline)) {
      await tester.pump(const Duration(milliseconds: 100));
      if (until.evaluate().isNotEmpty) return;
    }
    await note(
      '  tap $attempt on ${what ?? finder} did not bring up '
      '${expecting ?? until} — trying again',
    );
  }
  await waitFor(tester, until, what: expecting);
}

Future<void> type(WidgetTester tester, Key key, String text) async {
  await waitFor(tester, find.byKey(key));
  await tester.tap(find.byKey(key));
  await tester.pump(const Duration(milliseconds: 100));
  tester.testTextInput.enterText(text);
  await tester.pump(const Duration(milliseconds: 100));

  final got = tester.widget<TextField>(find.byKey(key)).controller?.text ?? '';
  if (got != text) {
    // One more way, in case a field is not the one holding focus.
    await tester.enterText(find.byKey(key), text);
    await tester.pump(const Duration(milliseconds: 100));
    final second =
        tester.widget<TextField>(find.byKey(key)).controller?.text ?? '';
    if (second != text) {
      await note('  typing into $key did not stick: field holds "$second"');
      fail('could not type into $key — the field holds "$second"');
    }
  }
}

/// Poll the mail sink until the sign-up code for [email] shows up.
Future<String> codeFromMail(WidgetTester tester, String email) async {
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
      '$mailBase/messages',
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

/// Start a conversation of one's own, say something in it, and come back to find it still there.
///
/// Kept here rather than in a journey of its own: everything a person does before there is a
/// machine belongs to every journey, and a second journey that repeated it would cost a whole run
/// to say the same thing twice. See todo/microteams/testing-e2e.md on the shape of the matrix.
Future<({String title, String said, String location})> talkInAChatOfYourOwn(
  WidgetTester tester,
) async {
  // --- start a conversation -------------------------------------------------------------------
  final title = 'journey $runId';
  await tap(
    tester,
    find.byIcon(Icons.add_comment_outlined),
    what: 'the new-chat button',
  );
  await waitFor(tester, find.text('New chat'), what: 'the New chat dialog');
  await typeInto(tester, find.widgetWithText(TextField, 'Title'), title);
  await tap(
    tester,
    find.widgetWithText(FilledButton, 'Create'),
    what: "the New chat dialog's Create",
  );

  // --- say something ---------------------------------------------------------------------------
  await waitFor(
    tester,
    find.widgetWithText(TextField, 'message…'),
    what: 'the composer',
  );
  final said = 'hello from $runId';
  await typeInto(tester, find.widgetWithText(TextField, 'message…'), said);
  await tap(
    tester,
    find.widgetWithText(FilledButton, 'send'),
    what: 'the send button',
  );

  // The bubble alone proves nothing: it is painted optimistically the instant the send button is
  // pressed, and it would look exactly the same if the request never left. What proves the
  // message is on the server is the 'sending…' clock going away — the outbox only drops that
  // when the stored message comes back with an id.
  await waitFor(tester, find.text(said), what: 'the message bubble');
  // Emptied, so the next message does not start with the last one still in it. (This is what
  // test/chats/send_test.dart used to assert against a fake; here it is the real composer after a
  // real send.)
  expect(
    tester
        .widget<TextField>(find.widgetWithText(TextField, 'message…').first)
        .controller
        ?.text,
    isEmpty,
    reason: 'the composer should be empty once the message is away',
  );
  await waitUntilGone(
    tester,
    find.byIcon(Icons.schedule),
    what: 'the sending… clock',
  );

  // Then leave the thread and come back, so the messages are read again rather than remembered.
  // How you leave depends on the shape of the window: a phone stacks the thread over the list and
  // offers a back button, a desktop shows both at once and has none. The journey has to work on
  // whatever client it was handed, so it asks rather than assumes.
  if (find.byTooltip('Back').evaluate().isNotEmpty) {
    await tap(tester, find.byTooltip('Back'), what: 'the back button');
    await waitFor(
      tester,
      find.text(title),
      what: 'the thread back in the list',
    );
  }
  await tap(tester, find.text(title), what: 'the thread in the list');
  await waitFor(tester, find.text(said), what: 'the message, read back');

  // Taken here, with the thread open, because a thread has its own address (/chats/:threadId) and
  // the list does not. Read it at the end of this function instead and you get /chats — an address
  // that refuses nobody, and a stranger check that proves nothing. (It did, once: the reverse run
  // reported "walked into somebody else's conversation at /chats".)
  final location = whereWeAre(tester);

  // --- the tab you come back to is the tab you left ---------------------------------------------
  // A rule the shell has had since the React client, and one of the few things about navigation
  // worth testing: leaving a conversation for another section and coming back should not put you
  // in front of the list again. (This is test/shell_test.dart's first case, against the real
  // shell instead of a toy router.)
  await tap(
    tester,
    find.byKey(const ValueKey('destination-agents')),
    what: 'the agents tab',
  );
  await waitFor(tester, find.text('machines'), what: 'the agents page');
  await tap(
    tester,
    find.byKey(const ValueKey('destination-chats')),
    what: 'the chats tab, coming back',
  );
  await waitFor(
    tester,
    find.text(said),
    what: 'the conversation that was open, still open',
  );

  // And tapping the tab you are already on goes back to its root — the way out of a detail view.
  await tap(
    tester,
    find.byKey(const ValueKey('destination-chats')),
    what: 'the chats tab again',
  );
  await waitUntilGone(
    tester,
    find.widgetWithText(TextField, 'message…'),
    what: 'the composer, on the way back to the list',
  );
  // Where this conversation lives, so somebody who is NOT in it can be sent to the same address.
  return (title: title, said: said, location: location);
}

/// The address the app is at, as the browser's own bar would show it.
String whereWeAre(WidgetTester tester) {
  final context = tester.element(find.byType(Navigator).first);
  return GoRouter.of(context).state.uri.toString();
}
