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
import 'package:microteams/src/common/ui/theme.dart';

/// Where the mail sink can be reached FROM THE BROWSER. The gateway puts it on this origin, so the
/// test asks nobody for permission: a cross-origin fetch would drag CORS into a test about
/// something else entirely.
const mailBase = String.fromEnvironment('MT_E2E_MAIL', defaultValue: '/mail');

/// What differs from one run to the next, fetched rather than compiled in.
///
/// A `--dart-define` is baked into the binary at build time. That is fine for a build made for this
/// run, and impossible for one built ahead of it: an APK built once and installed for every run
/// cannot carry this run's id, and certainly cannot carry an enrolment code that did not exist when
/// it was built. The mail sink is already the run's side channel in both directions, so the harness
/// leaves them there and the journey collects them on the way up — see [collectRunParameters].
var _given = <String, String>{};

/// A token unique to this run. Every name a journey invents contains it, which is what lets any
/// number of journeys share one deployment.
String get runId => _given['runId'] ?? '';

/// The code the machine printed when it started enrolling, empty when this run spun no machine.
String get enrollCode => _given['enrollCode'] ?? '';

/// Ask the mail sink what this run is.
///
/// Failing here is fatal on purpose, unlike [note]: a journey that ran on the previous run's id
/// would collide with names that already exist and fail somewhere far less legible.
Future<void> collectRunParameters() async {
  Object? last;
  for (var attempt = 0; attempt < 10; attempt++) {
    try {
      final got = await Dio(
        BaseOptions(
          connectTimeout: const Duration(seconds: 5),
          receiveTimeout: const Duration(seconds: 5),
        ),
      ).get<Map<String, dynamic>>('$mailBase/run');
      final params = got.data ?? const {};
      if (params['runId'] is String && (params['runId'] as String).isNotEmpty) {
        _given = params.map((key, value) => MapEntry(key, '$value'));
        return;
      }
      last = 'the harness has not said yet: $params';
    } catch (error) {
      last = error;
    }
    await Future<void>.delayed(const Duration(seconds: 1));
  }
  fail('could not read this run\'s parameters from $mailBase/run — $last');
}

/// Meets the four rules the register form checks, and never needs to change with them.
const password = 'E2e-passw0rd!';

/// The step being waited on, for anything that has to report from somewhere it cannot ask.
String _step = 'starting up';

/// Overflows seen since the last time they were reported. Drained from [waitFor], because inside the
/// error handler there is nothing safe to await.
final _overflows = <String>[];

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
  // What every field is actually holding. A form that looks right and submits wrong is the failure
  // this answers: on Android the fields have come back shifted by one, and the labels on screen say
  // nothing about which value landed where.
  final fields = find
      .byType(TextField)
      .evaluate()
      .map((element) => element.widget as TextField)
      .map((field) => '${field.key}="${field.controller?.text ?? ''}"')
      .toList();
  await note('  the fields hold: ${fields.join(' | ')}');
}

/// Boot the app, with a deadline.
///
/// An unbounded await here is the one failure this harness cannot report: the run just sits there
/// until something outside kills it, and the log says nothing at all.
Future<void> startApp(WidgetTester tester) async {
  await collectRunParameters();
  await note('booting the app');
  // Say WHERE an overflow happened, in terms of the step that was running.
  //
  // Flutter reports "a RenderFlex overflowed" at the end of the run, by which time the widget is
  // disposed and its creator chain reads DEFUNCT — enough to know something is clipped, not enough
  // to know what. Guessing from that cost a run: the field picked as the only candidate that fits
  // turned out not to be it (widened, the overflow was still exactly 55 pixels).
  //
  // The handler itself touches NOTHING but a string. Asking the tester where we are from in here is
  // a call into a guarded API from the middle of paint, and it fails the run with "Guarded function
  // conflict" — which cost another run. The last step's own name is already recorded, and it says
  // which screen was up just as well.
  final wasReporting = FlutterError.onError;
  FlutterError.onError = (details) {
    final what = details.exception.toString();
    if (what.contains('overflowed')) {
      // The whole report, not just the first line. Taken HERE, the creator chain still names live
      // widgets; the copy Flutter prints at the end of the run has been through disposal and every
      // entry reads DEFUNCT. Two runs were spent guessing from that, and both guesses were wrong.
      final full = details.toString().replaceAll('\n', ' ');
      _overflows.add(
        '${what.split('\n').first} — while: $_step — '
        '${full.substring(0, full.length > 1600 ? 1600 : full.length)}',
      );
    }
    wasReporting?.call(details);
  };
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

  // All four together, and not believed until they all read back — see [fill]. Typed one at a time
  // with a check each, this form came out shifted by a field on Android.
  await fill(tester, {
    const Key('register-username'): username,
    const Key('register-password'): password,
    const Key('register-confirm'): password,
    const Key('register-email'): email,
  });

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
  // The code went in last, so nothing else reads the email field back — and text that misses its
  // field lands in the one focused before it, which is exactly this one. Left unchecked it submits
  // a different address from the one that was mailed, and the form simply refuses with nothing on
  // screen to say why.
  final emailNow =
      tester
          .widget<TextField>(find.byKey(const Key('register-email')))
          .controller
          ?.text ??
      '';
  if (emailNow != email) {
    await note(
      '  the code overwrote the email field, which now holds "$emailNow"',
    );
    fail('typing the code landed in the email field — it holds "$emailNow"');
  }
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
  // Whatever overflowed during the step before this one, reported now — out here it is safe to
  // await, and the name it carries is the step it happened under.
  while (_overflows.isNotEmpty) {
    await note('  OVERFLOW: ${_overflows.removeAt(0)}');
  }
  _step = what ?? finder.toString();
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
  // Scroll it into view first. A wide window has room for everything and this changes nothing there;
  // a phone does not, and with the soft keyboard up the thing being tapped can be off the bottom of
  // the window — where the tap goes nowhere and the run reports only that what should have followed
  // never happened. Swallowed on purpose: plenty of what this taps is not inside a scrollable at
  // all, and that is not an error.
  try {
    await tester.ensureVisible(finder.first);
    await tester.pump(const Duration(milliseconds: 100));
  } catch (_) {}
  await tester.tap(finder.first);
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 100));
}

/// [type] by any finder, not just by key.
///
/// Types, then reads back, and says so loudly if the text did not stick. The read-back is not
/// belt-and-braces: it was briefly removed while [fill] was being written, on the theory that the
/// caller would check — and the very next CI run failed at a step that types one field and then
/// presses a button, with nothing to say about why. A field that quietly refuses text is exactly
/// the failure this suite exists to make loud.
///
/// [fill] is still the thing to use for a FORM, because one field's check cannot see the field
/// that the next one clobbered.
/// Tap a field and wait until it is really the one listening.
///
/// `testTextInput.enterText` does not address a widget: it delivers to whatever input connection is
/// attached at that moment. Attaching happens a frame or more after the tap, so text sent too early
/// lands in the field that was focused BEFORE — and lands there silently. On Android that is how the
/// register form came out "shifted by one": the code typed into the code field also overwrote the
/// email field, sign-up was then attempted against an address nobody had mailed, and the only sign
/// was a form that would not submit.
///
/// A single fixed pump is not enough, because how long the attach takes is not ours to know. So
/// this waits for the thing itself — the field's own EditableText holding focus — and then gives the
/// framework a few frames to finish wiring the connection up.
Future<void> takeFocus(WidgetTester tester, Finder field) async {
  // `showKeyboard`, not `tap`. A tap has to hit the widget, and on a phone-sized screen this form
  // does not fit: the field can be under the soft keyboard or off the bottom, and then the tap
  // focuses nothing at all — measured, on the register form, where the field never took focus in
  // five seconds of pumping. `showKeyboard` asks the field for focus directly and attaches the
  // input connection to it, which is the thing the typing actually needs.
  await tester.ensureVisible(field);
  await tester.pump(const Duration(milliseconds: 100));
  await tester.showKeyboard(field);
  final editable = find.descendant(
    of: field,
    matching: find.byType(EditableText),
  );
  for (
    var waited = Duration.zero;
    waited < const Duration(seconds: 5);
    waited += const Duration(milliseconds: 100)
  ) {
    await tester.pump(const Duration(milliseconds: 100));
    final found = editable.evaluate();
    if (found.isNotEmpty &&
        (found.first.widget as EditableText).focusNode.hasFocus) {
      // Focus is not the connection. Both arrive in the same handful of frames, and these are what
      // the connection needs after focus has landed.
      for (var i = 0; i < 3; i++) {
        await tester.pump(const Duration(milliseconds: 100));
      }
      return;
    }
  }
  await note('  a field never took focus');
}

Future<void> typeInto(WidgetTester tester, Finder finder, String text) async {
  await waitFor(tester, finder, what: 'a field to type "$text" into');

  // The controller is taken BEFORE typing, and the read-back goes through it rather than through
  // the finder again. Finders can stop matching the thing they just matched: the composer is found
  // by its placeholder, `find.widgetWithText(TextField, 'message…')`, and a placeholder is exactly
  // what leaves the tree once the box has text in it. Re-running that finder afterwards therefore
  // asks about some other box — and it reported an empty one, so a field that had in fact been
  // filled correctly was declared broken. A controller outlives its widget's rebuilds; a finder
  // outlives nothing.
  final controller = tester.widget<TextField>(finder.first).controller;

  // Tap first, then testTextInput — the order that has always been green on the web. What changed is
  // that the wait between them is no longer a fixed pump but [takeFocus], which waits for the field
  // to actually be the one listening. `enterText` stays as the fallback for a widget that will not
  // take text this way.
  await takeFocus(tester, finder.first);
  tester.testTextInput.enterText(text);
  await tester.pump(const Duration(milliseconds: 100));

  if (controller?.text != text) {
    await tester.enterText(finder.first, text);
    await tester.pump(const Duration(milliseconds: 100));
  }
  final got = controller?.text ?? '';
  if (got != text) {
    await note('  typing did not stick: the field holds "$got"');
    fail('could not type into a field — it holds "$got"');
  }
}

/// What a field is holding right now, or null if it is not on screen.
String? _held(WidgetTester tester, Key key) {
  final f = find.byKey(key);
  if (f.evaluate().isEmpty) return null;
  return tester.widget<TextField>(f.first).controller?.text;
}

/// Fill a form and do not believe it until every field reads back.
///
/// Typing into a named field is not the simple thing it looks like. `tester.enterText` is
/// `showKeyboard` followed by `testTextInput.enterText`, and showKeyboard only sets
/// `binding.focusedEditable` — which, as its own comment says, "eventually calls TextInput.attach to
/// establish the connection". On the web that attach is a synchronous fake and the single `pump()`
/// inside showKeyboard is plenty. On a real device it is a genuine platform round trip, so the text
/// can be delivered to the client that was attached BEFORE this one.
///
/// The result on Android was a form shifted by exactly one field: the confirm-password box held the
/// email address, and the email box was therefore empty. That disabled the send-code button, so
/// tapping it did nothing and the journey waited a minute for a message that was never requested —
/// while the screen showed "the two passwords do not match", which gates a different button
/// entirely and had never blocked anything. Two symptoms, both pointing away from typing.
///
/// So: fill everything, read everything back, re-fill whatever is wrong, and repeat. That needs no
/// guess about how many frames an attach takes, and it repairs the field that the NEXT one landed
/// in — which a per-field check cannot do, because at the moment it looks, the field is still right.
///
/// What is established and what is not, so nobody reads more into this than it earned: the shift is
/// measured — a diagnostic run printed the confirm box holding the email address — and the cause is
/// read off flutter_test's own source, quoted above. That the repeat CONVERGES on a device is not
/// yet demonstrated; the machine borrowed to prove it could not finish a build. If it ever does not
/// converge, this fails loudly with every field's contents rather than quietly moving on, which is
/// the failure worth having.
Future<void> fill(WidgetTester tester, Map<Key, String> fields) async {
  for (final entry in fields.entries) {
    await typeInto(tester, find.byKey(entry.key), entry.value);
  }

  for (var round = 1; round <= 5; round++) {
    final wrong = <Key, String>{
      for (final e in fields.entries)
        if (_held(tester, e.key) != e.value) e.key: e.value,
    };
    if (wrong.isEmpty) return;

    await note(
      '  ${wrong.length} field(s) did not hold what was typed — round $round',
    );
    for (final entry in wrong.entries) {
      await typeInto(tester, find.byKey(entry.key), entry.value);
      await tester.pump(const Duration(milliseconds: 200));
    }
  }

  final held = {
    for (final e in fields.entries) '${e.key}': _held(tester, e.key),
  };
  await note('  giving up on the form: $held');
  fail('a form would not hold what was typed into it: $held');
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
  // Named, because without it the trace prints the whole widget description — pages of it — instead
  // of saying which field it is waiting for.
  await waitFor(tester, find.byKey(key), what: 'the $key field');
  await takeFocus(tester, find.byKey(key));
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
  //
  // Where you leave FROM depends on the shape of the window, and the difference is deliberate: on a
  // phone, inside a conversation, there is no tab bar at all — the conversation wants those pixels,
  // and WeChat does not show one there either. So the phone leaves the conversation first, and on
  // the way asserts the bar really is gone; asserting the wide behaviour here would be asserting
  // something this product deliberately does not do.
  final wide = isWide(tester.element(find.byType(Navigator).first));
  if (!wide) {
    expect(
      find.byKey(const ValueKey('destination-agents')),
      findsNothing,
      reason: 'a phone shows no tab bar inside a conversation',
    );
    await tap(
      tester,
      find.byTooltip('Back'),
      what: 'the back button, out of the conversation',
    );
    await waitFor(
      tester,
      find.text(title),
      what: 'the list, with the tab bar back',
    );
  }
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
    // What "where you left off" means differs with the shape, and both are the same rule: the
    // conversation on a desktop, which never left the screen; the list on a phone, which is where
    // this branch was when it was last seen.
    wide ? find.text(said) : find.text(title),
    what: 'the chats branch, where it was left',
  );

  if (wide) {
    // And tapping the tab you are already on goes back to its root — the way out of a detail view.
    // Only where there is a detail view to be in: a phone is already at the root here.
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
  }
  // Where this conversation lives, so somebody who is NOT in it can be sent to the same address.
  return (title: title, said: said, location: location);
}

/// Reach a tab, from wherever the journey happens to be.
///
/// On a phone the tab bar is deliberately absent inside a conversation (see the shell: the
/// conversation wants those pixels), so a journey that simply taps the tab works on a desktop and
/// times out on a device — twice over, in two different places, before this existed. Coming out of
/// the conversation first is what a person does there, and on a wide window there is nothing to come
/// out of, so the loop does nothing.
Future<void> goToTab(WidgetTester tester, String label) async {
  final tab = find.byKey(ValueKey('destination-$label'));
  for (var i = 0; i < 3 && tab.evaluate().isEmpty; i++) {
    final back = find.byTooltip('Back');
    if (back.evaluate().isEmpty) break;
    await tap(tester, back, what: 'back, on the way to the $label tab');
  }
  await tap(tester, tab, what: 'the $label tab');
}

/// The address the app is at, as the browser's own bar would show it.
String whereWeAre(WidgetTester tester) {
  final context = tester.element(find.byType(Navigator).first);
  return GoRouter.of(context).state.uri.toString();
}
