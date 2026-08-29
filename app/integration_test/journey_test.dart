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
/// Parameters (all --dart-define): see support.dart.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

import 'support.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('a new person signs up, starts a chat, and is heard', (
    tester,
  ) async {
    expect(runId, isNotEmpty, reason: 'MT_E2E_RUN was not passed in');

    await startApp(tester);
    await signUp(tester);

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
  }, timeout: const Timeout(Duration(minutes: 6)));
}
