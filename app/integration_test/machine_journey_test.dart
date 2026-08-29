/// The second vertical slice: a person brings a machine in and opens an agent on it.
///
/// This is the half of the product that lives outside the browser — a real host running the
/// connector, a private tmux, a program in it — and until now the only thing that exercised it was
/// a shell script driving the API with curl. That script proved the machinery worked; it could not
/// prove a person could *reach* it, because it never touched the interface. This journey does the
/// human half through the interface and leaves the machine half to the harness outside, which is
/// the only part a person does not do.
///
/// The division of labour, and why it is that way:
///   * outside (tool/e2e/run.sh): spin the host, install the connector FROM THE BUNDLE, start
///     enrolment, and hand this test the one-time code — exactly what a person would read off the
///     terminal on the machine in front of them.
///   * here: make a team, open the approval link, approve it, watch the machine come online, open
///     an agent on it, and talk to it.
///   * outside again, afterwards: assert the program on the machine actually heard what was said.
///     That assertion cannot live in here, because it is about a file on another host.
///
/// Parameters (all --dart-define): those in support.dart, plus MT_E2E_ENROLL_CODE.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:integration_test/integration_test.dart';

import 'support.dart';

const _enrollCode = String.fromEnvironment('MT_E2E_ENROLL_CODE');

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('a person enrols a machine and opens an agent on it', (
    tester,
  ) async {
    expect(runId, isNotEmpty, reason: 'MT_E2E_RUN was not passed in');
    expect(
      _enrollCode,
      isNotEmpty,
      reason: 'MT_E2E_ENROLL_CODE was not passed in — the harness starts the '
          'enrolment on the machine and hands the code over',
    );

    await startApp(tester);
    await signUp(tester, suffix: 'm');

    // --- a team for the machine to serve ---------------------------------------------------------
    // Approval needs one: a machine serves teams, and a person with no team has nothing to offer it.
    final teamName = 'team $runId';
    await go(tester, '/teams');
    await tap(tester, find.byTooltip('new team'), what: 'the new-team button');
    await waitFor(tester, find.text('new team'), what: 'the new-team dialog');
    await typeInto(tester, find.byType(TextField).first, teamName);
    await tap(
      tester,
      find.widgetWithText(TextButton, 'create'),
      what: "the dialog's create",
    );
    await waitFor(tester, find.text(teamName), what: 'the new team in the list');

    // --- approve the machine ---------------------------------------------------------------------
    // `microteams link auto-connect` prints a link for a person to open; opening it is what this is.
    await go(tester, '/connect?code=$_enrollCode');
    await waitFor(
      tester,
      find.text('approve device'),
      what: 'the approval page',
    );
    await tap(
      tester,
      find.widgetWithText(CheckboxListTile, teamName),
      what: 'the team to serve',
    );
    await tap(
      tester,
      find.widgetWithText(FilledButton, 'approve this machine'),
      what: 'the approve button',
    );
    await waitFor(
      tester,
      find.text('machine approved'),
      what: 'the approval landing',
    );
    await tap(
      tester,
      find.widgetWithText(FilledButton, 'go to agents'),
      what: 'go to agents',
    );

    // --- wait for it to actually be there ---------------------------------------------------------
    // Enrolled is not connected. The connector on the machine polls, gets its token, and dials in;
    // until then the app says "(not connected)" and an agent opened there would never start. This
    // is the one wait in the journey that is about another host, so it gets a longer limit.
    await waitFor(
      tester,
      find.textContaining('machines'),
      what: 'the agents page',
    );
    await waitUntilGone(
      tester,
      find.textContaining('(not connected)'),
      what: 'the machine to come online',
      limit: const Duration(minutes: 2),
    );

    // --- open an agent on it -----------------------------------------------------------------------
    final agentName = 'agent$runId';
    await tap(tester, find.text('open agent'), what: 'the open-agent button');
    await waitFor(tester, find.text('Open agent'), what: 'the open-agent dialog');
    await typeInto(
      tester,
      find.widgetWithText(TextField, 'the server names it if you do not'),
      agentName,
    );
    await tap(
      tester,
      find.widgetWithText(FilledButton, 'Open'),
      what: "the dialog's Open",
    );
    await waitFor(
      tester,
      find.text(agentName),
      what: 'the agent in the fleet',
      limit: const Duration(minutes: 2),
    );

    // --- say something to it ------------------------------------------------------------------------
    // Opening an agent does NOT make a chat with it — "chat with agent", on the agent's own page,
    // is what does, and it is the path a person actually takes.
    await tapUntil(
      tester,
      find.text(agentName),
      find.text('chat with agent'),
      what: 'the agent, to open it',
      expecting: 'the agent’s own page',
    );
    await tap(
      tester,
      find.text('chat with agent'),
      what: 'the chat-with-agent button',
    );
    await waitFor(
      tester,
      find.widgetWithText(TextField, 'message…'),
      what: 'the composer',
    );
    // The marker is what the harness greps for on the machine afterwards: a message that reached a
    // program's stdin on another host is the assertion this whole slice exists for.
    final said = 'e2e-marker-$runId';
    await typeInto(tester, find.widgetWithText(TextField, 'message…'), said);
    await tap(
      tester,
      find.widgetWithText(FilledButton, 'send'),
      what: 'the send button',
    );
    await waitFor(tester, find.text(said), what: 'the message bubble');
    await waitUntilGone(
      tester,
      find.byIcon(Icons.schedule),
      what: 'the sending… clock',
    );
  }, timeout: const Timeout(Duration(minutes: 12)));
}

/// Follow a link, the way a person following a link does.
///
/// Used for the two places a journey arrives at by URL rather than by tapping: the approval link
/// the CLI prints on the machine, and jumping between the app's own sections.
Future<void> go(WidgetTester tester, String location) async {
  final context = tester.element(find.byType(Navigator).first);
  GoRouter.of(context).go(location);
  for (var i = 0; i < 20; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}
