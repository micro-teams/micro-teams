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
import 'package:microteams/src/common/ui/team_picker.dart';
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
      reason:
          'MT_E2E_ENROLL_CODE was not passed in — the harness starts the '
          'enrolment on the machine and hands the code over',
    );

    await startApp(tester);
    // The nickname follows the username unless it is edited, and this journey never edits it — so
    // this is also the name the roster will show further down.
    final me = await signUp(tester, suffix: 'm');

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
    await waitFor(
      tester,
      find.text(teamName),
      what: 'the new team in the list',
    );
    // Made and then not selected is a team you have to go and find, so making one is also a
    // statement about where you intend to work. (test/teams/team_admin_test.dart used to say this
    // against a fake; here the picker at the top of the next page says it.)
    await go(tester, '/agents');
    await waitFor(
      tester,
      find.widgetWithText(TeamPickerAction, teamName),
      what: 'the new team, picked',
    );

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
    await waitFor(
      tester,
      find.text('Open agent'),
      what: 'the open-agent dialog',
    );
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

    // Asking for the conversation again has to give back the SAME one. A second one every time is
    // how a chat list fills up with duplicates of the same agent — and from out here "the same one"
    // has an honest test: what was said in it is still there.
    await tap(
      tester,
      find.byKey(const ValueKey('destination-agents')),
      what: 'the agents tab',
    );
    await tapUntil(
      tester,
      find.text(agentName),
      find.text('chat with agent'),
      what: 'the agent again',
      expecting: 'its page',
    );
    await tap(
      tester,
      find.text('chat with agent'),
      what: 'chat with agent, a second time',
    );
    await waitFor(
      tester,
      find.text(said),
      what: 'the same conversation, with what was already said in it',
    );

    // Who is in this conversation: the person who made it, and the agent it is with. (This is
    // test/chats/thread_info_test.dart's roster case, with a roster the server actually built.)
    await tap(tester, find.byIcon(Icons.info_outline), what: 'the info button');
    await waitFor(
      tester,
      find.text(agentName),
      what: 'the agent, in the roster',
    );
    await waitFor(
      tester,
      find.text(me),
      what: 'the person who made it, in the roster',
    );

    // --- and a document in the team's own tree -----------------------------------------------------
    // The team has a tree of its own from the moment it exists — a real git repository on the server
    // — and this is the shortest journey through it: touch the tree's own row, make a file in it,
    // watch it appear. (test/docs/tree_actions_test.dart makes the same file against a fake tree.)
    //
    // Two details that cost a run each, both worth keeping in mind for anything else in this tree:
    // the team's name is on screen twice (the row AND the team picker above it), so the finder has
    // to say which one; and a row's "..." is only drawn for the row you last touched, because a
    // column of them down every row is noise. Tapping the row is what makes it reachable.
    await tap(
      tester,
      find.byKey(const ValueKey('destination-docs')),
      what: 'the docs tab',
    );
    final docName = 'note-$runId.md';
    await newInTree(tester, on: teamName, named: docName);
    await revealIn(tester, teamName, treeRowFor(docName), what: docName);

    // Where a new file lands is the rule this tree lives by, and it is a rule about paths: asking a
    // FOLDER for a new file puts it inside, asking a FILE for one puts it beside. The widget tests
    // that cover this can only see the shape of the request; here the tree itself answers, which is
    // what a person is actually looking at.
    final folder = 'notes-$runId';
    await newInTree(tester, on: teamName, folder: true, named: folder);
    await revealIn(tester, teamName, treeRowFor(folder), what: folder);

    await newInTree(tester, on: folder, named: 'inside.md');
    await revealIn(tester, folder, treeRowFor('inside.md'), what: 'inside.md');

    await newInTree(tester, on: 'inside.md', named: 'beside.md');
    await revealIn(tester, folder, treeRowFor('beside.md'), what: 'beside.md');

    // Renaming happens in the row itself, and a name is not a path: typing one must rename the file
    // where it is, not move it to the root. From out here that is one question — is it still under
    // the folder afterwards — and the tree answers it.
    await actionsFor(tester, 'beside.md');
    await tap(tester, find.text('rename'), what: 'rename');
    final field = find.descendant(
      of: find.byType(ListView),
      matching: find.byType(TextField),
    );
    await waitFor(tester, field, what: 'the row, turned into a field');
    expect(
      find.byType(AlertDialog),
      findsNothing,
      reason: 'renaming happens in the row, not in a dialog over it',
    );
    await typeInto(tester, field, 'renamed.md');
    await tap(tester, find.byIcon(Icons.check), what: 'the tick');
    await revealIn(
      tester,
      folder,
      treeRowFor('renamed.md'),
      what: 'renamed.md',
    );

    // And deleting really deletes: the row goes. (Cancelling instead is still a widget test — the
    // only way to be sure NOTHING was sent is to hold the wire.)
    await actionsFor(tester, 'renamed.md');
    await tap(tester, find.text('delete'), what: 'delete');
    await waitFor(
      tester,
      find.text('delete renamed.md?'),
      what: 'the question',
    );
    await tap(
      tester,
      find.widgetWithText(TextButton, 'delete'),
      what: 'confirming it',
    );
    await waitUntilGone(
      tester,
      treeRowFor('renamed.md'),
      what: 'the deleted file',
    );

    // --- and finally, the agent's own two buttons ---------------------------------------------------
    // Renaming happens in a dialog that is a ROUTE, so it can be backed out of rather than taking the
    // page with it; closing asks first, because a session that stops takes whatever it was doing with
    // it. Both are done last: closing really does end the agent.
    await tap(
      tester,
      find.byKey(const ValueKey('destination-agents')),
      what: 'the agents tab',
    );
    await tapUntil(
      tester,
      find.text(agentName),
      find.byTooltip('rename'),
      what: 'the agent',
      expecting: 'its page',
    );
    await tap(tester, find.byTooltip('rename'), what: 'rename');
    await waitFor(
      tester,
      find.text('rename $agentName'),
      what: 'the rename dialog',
    );
    final newName = '$agentName-renamed';
    await typeInto(
      tester,
      find.descendant(
        of: find.byType(AlertDialog),
        matching: find.byType(TextField),
      ),
      newName,
    );
    await tap(
      tester,
      find.widgetWithText(TextButton, 'rename'),
      what: "the dialog's rename",
    );
    await waitFor(tester, find.text(newName), what: 'the agent, renamed');

    await tap(tester, find.text('close agent'), what: 'close agent');
    await waitFor(
      tester,
      find.text('close $newName?'),
      what: 'the question, before anything is closed',
    );
    await tap(
      tester,
      find.widgetWithText(TextButton, 'close it'),
      what: 'confirming it',
    );
    await waitUntilGone(
      tester,
      find.text(newName),
      what: 'the agent, closed and gone from the fleet',
      limit: const Duration(minutes: 2),
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

/// The row for [name] in the tree, and nothing else on screen that says the same word — the team's
/// name in particular is also on the picker above the tree, and an open document's name is in the
/// pane beside it.
Finder treeRowFor(String name) =>
    find.descendant(of: find.byType(ListView), matching: find.text(name));

/// Open [folder] far enough to see [what], however many taps that takes.
///
/// Tapping a row in this tree TOGGLES it, and every folder starts closed — including the team's own
/// row, which is why a journey that taps it to reach its actions can easily leave it shut. So the
/// question asked here is not "did I tap" but "can I see it", which is also the question a person
/// asks. (Two runs were lost to this: the file that seemed to prove the tree was open was the
/// document open in the pane beside it, not a row.)
Future<void> revealIn(
  WidgetTester tester,
  String folder,
  Finder row, {
  required String what,
}) async {
  await tapUntil(
    tester,
    treeRowFor(folder),
    row,
    what: 'the row for $folder',
    expecting: what,
  );
}

/// Make a file (or a folder) from another row's own actions.
///
/// A row's "..." is only drawn for the row you last TOUCHED — a column of them down every row would
/// be noise — so the row is touched again every time rather than once. And "new file"/"new folder"
/// name both the menu item and the dialog it opens, so the wait afterwards is for the dialog's own
/// field, which only the dialog has.
Future<void> newInTree(
  WidgetTester tester, {
  required String on,
  required String named,
  bool folder = false,
}) async {
  await actionsFor(tester, on);
  await tap(
    tester,
    find.text(folder ? 'new folder' : 'new file').last,
    what: folder ? 'new folder' : 'new file',
  );

  final field = find.widgetWithText(TextField, folder ? 'notes' : 'idea.md');
  await waitFor(tester, field, what: 'the name field');
  await typeInto(tester, field, named);
  await tap(
    tester,
    find.widgetWithText(TextButton, 'create'),
    what: "the dialog's create",
  );
}

/// Open the "..." belonging to [name] — and to [name], not to whichever row was touched last.
///
/// The trap: only one row shows its "..." at a time, so `find.byTooltip('actions')` matches whatever
/// is currently showing. Wait for one to exist and it may already be there, belonging to the
/// previous row — and the menu that opens is that row's. (This deleted the wrong file once: the
/// dialog said "delete inside.md?" while the journey thought it was deleting renamed.md.) Scoping
/// the finder to this row's own subtree is what makes the question the right one.
Future<void> actionsFor(WidgetTester tester, String name) async {
  final row = find.ancestor(
    of: treeRowFor(name),
    matching: find.byType(MouseRegion),
  );
  final itsActions = find.descendant(
    of: row.first,
    matching: find.byTooltip('actions'),
  );
  await tapUntil(
    tester,
    treeRowFor(name),
    itsActions,
    what: 'the row for $name',
    expecting: "$name's own actions",
  );
  await tap(tester, itsActions, what: "$name's actions");
}
