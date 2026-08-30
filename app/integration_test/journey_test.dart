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

    // (There is no settings gear to press here: where the server is pointed is a native client's
    // question, and the web build has no such control — the page came from the server. So
    // "a dialog is reachable before sign-in" stays a widget test; on the web there is nothing to
    // reach it with.)
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

    // --- and out again ------------------------------------------------------------------------------
    // Your own face is the way to your own page — no menu in front of it — and logging out lives
    // there. Ending the journey here is not tidiness: signing out has broken twice in this client,
    // both times in a way that only showed up against a real server (an unauthenticated request that
    // left the refresh cookie alive, and a router that sent the confirmation dialog to /login).
    await tap(
      tester,
      find.byKey(const ValueKey('destination-me')),
      what: 'your own face',
    );
    await waitFor(tester, find.text('log out'), what: 'your own page');
    await tap(tester, find.text('log out'), what: 'log out');
    await waitFor(tester, find.text('log out?'), what: 'the confirmation');
    await tap(
      tester,
      find.widgetWithText(TextButton, 'log out').last,
      what: 'confirming it',
    );
    await waitFor(
      tester,
      find.text('no account? register'),
      what: 'the login page, signed out',
    );
  }, timeout: const Timeout(Duration(minutes: 8)));
}
