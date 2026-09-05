/// One journey, end to end: a person signs up, works in the app, brings a machine in, and puts an
/// agent on it.
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
/// Parameters: the mail sink hands over this run's id and, when a machine was spun for it, the
/// enrolment code — see collectRunParameters in support.dart for why they are not compiled in.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:xterm/xterm.dart';
import 'package:microteams/src/common/ui/avatar.dart';
import 'package:microteams/src/common/ui/team_picker.dart';
import 'package:microteams/src/common/ui/theme.dart';
import 'package:integration_test/integration_test.dart';

import 'support.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('a person signs up, brings a machine in, and works with an agent', (
    tester,
  ) async {
    await startApp(tester);
    // The nickname follows the username unless it is edited, and this journey never edits it — so
    // this is also the name the roster will show further down.
    final me = await signUp(tester);

    // Everything a person does before there is a machine. It lives in support.dart because it
    // belongs to every journey: a separate journey repeating it would spend a whole run saying the
    // same thing twice, and the matrix below is meant to be max(clients, environments) runs — not
    // clients plus environments.
    // Asked once, of the product's own rule, and used wherever the shape changes what can be asked.
    final wideClient = isWide(tester.element(find.byType(Navigator).first));

    final mine = await talkInAChatOfYourOwn(tester);

    // No code means no host was spun for this run (`--journey no-machine`, for iterating locally on
    // the app half). Everything from here needs one, so the journey stops rather than pretending it
    // did something it did not.
    if (enrollCode.isEmpty) {
      await note('no machine was handed over — stopping after the app half');
      return;
    }

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
    await go(tester, '/connect?code=$enrollCode');
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
    await goToTab(tester, 'agents');
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

    // --- the shell is still the shell React had ------------------------------------------------
    // Measured on the real screen, in a real conversation, because every one of these failed
    // invisibly once: the code was right and the pixels were not. (This is what test/chats/
    // bubble_test.dart measured against a fake, minus the cases that need two people talking.)
    await lookRight(tester);

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

    // --- the terminal, over a real machine ------------------------------------------------------
    // The fleet has had a real host in it this whole journey and the journey had never once opened
    // its terminal — so everything about live screens was tested against a fake socket, which is
    // exactly the thing that never makes the mistakes a real machine makes.
    //
    // A face is how you ask for a screen: an avatar has no business knowing how this app shows a
    // terminal, so it calls a handler the app sets once at the top (common/ui/avatar.dart). It has
    // to be the AGENT's face — every other one answers "no live screen for them" — and it has to be
    // a face with nothing competing for the tap. Not the fleet row: there the terminal opens and
    // the row's own tap fires too, landing on the agent's page with the terminal behind it. The
    // roster here is a plain grid of faces, so the only gesture is the one being tested.
    final face = find
        .descendant(
          of: find.ancestor(
            of: find.text(agentName),
            matching: find.byType(SizedBox),
          ),
          matching: find.byType(UserAvatar),
        )
        .first;
    await waitFor(tester, face, what: "the agent's face in the roster");
    // Aimed low and left, not at the middle. The remove button is pinned to the face's top-right
    // corner, and an IconButton's hit area is far bigger than the 16px cross it draws — big enough,
    // on a phone, to cover the middle of a 56px face. Tapping the centre brought up "remove agent?"
    // instead of the screen. Where a person aims at a face is the lower half of it, so that is where
    // this aims, and the rect goes into the trace so a future failure here says which it hit.
    final rect = tester.getRect(face);
    await note('  the face is at $rect');
    await tester.tapAt(
      Offset(rect.left + rect.width * 0.3, rect.bottom - rect.height * 0.3),
    );
    await tester.pump(const Duration(milliseconds: 200));
    await waitFor(
      tester,
      find.byTooltip('watching'),
      what: 'the terminal, open and in watching mode',
    );

    // What the machine is actually printing, read out of the screen buffer.
    //
    // Not with a text finder: a terminal is painted, not laid out — TerminalView draws its grid
    // itself, so there is no Text widget anywhere in it and `find.textContaining` can only ever
    // find nothing. What the widget does carry is the Terminal, and its buffer is what arrived.
    //
    // What is looked for is the message this journey itself sent to the agent a few steps up. It
    // has travelled the whole way — app, backend, connector, pty, tmux, and back through the screen
    // socket into this buffer — so finding it here is the round trip in one assertion. (It used to
    // look for a line a stand-in program printed at startup; the agent is the real Claude Code now,
    // and its banner is a thing Anthropic can change, while our own marker is not.)
    // Three minutes, not one, and it says what it is seeing while it waits. On a phone-sized client
    // the buffer was still a single newline after a full minute — which is a different failure from
    // "the wrong text arrived", and the trace could not tell them apart. What it holds, and whether
    // it is filling at all, is the thing worth knowing here.
    final deadline = DateTime.now().add(const Duration(minutes: 3));
    String screen = '';
    var reported = DateTime.now();
    while (DateTime.now().isBefore(deadline)) {
      final view = tester.widget<TerminalView>(find.byType(TerminalView));
      screen = view.terminal.buffer.getText();
      if (screen.contains(said)) break;
      if (DateTime.now().difference(reported) > const Duration(seconds: 30)) {
        reported = DateTime.now();
        final trimmed = screen.trim();
        await note(
          '  the terminal holds ${trimmed.length} characters so far'
          '${trimmed.isEmpty ? '' : ': ${trimmed.substring(trimmed.length > 120 ? trimmed.length - 120 : 0)}'}',
        );
      }
      await tester.pump(const Duration(milliseconds: 500));
    }
    // What can be asked here depends on how big the screen is, and that is not a compromise.
    // A terminal shows the screen, not the history, and the agent's program repaints the whole of
    // it: on a desktop-sized terminal the line this journey sent is still up there, and on a phone
    // (measured: 1351 characters of a full-screen TUI, redrawn) it has been painted over. Demanding
    // it there would be demanding that the product keep something it never promised to keep.
    //
    // The round trip is not going untested — it is tested better, outside: the harness asks the mock
    // Anthropic API whether the MODEL was given this marker, which proves the text crossed the pty
    // and the TUI as well as the pipe. What is left for here is what only here can see: that this
    // terminal is a live one, carrying the agent's own screen rather than an empty rectangle.
    if (wideClient) {
      expect(
        screen,
        contains(said),
        reason: 'what was sent to the agent never appeared on its own screen',
      );
    } else {
      expect(
        screen.trim().length,
        greaterThan(200),
        reason:
            'the terminal opened but the machine never painted anything into it',
      );
    }
    await note(
      'the terminal opened over a real machine and its output arrived',
    );

    // Watching never types; typing is a mode you choose, and choosing it tells the machine. Only a
    // machine can fail to be told, which is why this is here and not in a widget test.
    await tap(tester, find.byTooltip('typing'), what: 'the typing mode');
    await waitFor(
      tester,
      find.text('the agent is not driving'),
      what: 'the warning that comes with taking the keyboard',
    );

    // And closing puts the terminal away without taking what was underneath with it.
    await tap(tester, find.byTooltip('close'), what: 'closing the terminal');
    await waitUntilGone(
      tester,
      find.byTooltip('watching'),
      what: 'the terminal, put away',
    );
    await waitFor(
      tester,
      find.text(me),
      what: 'the roster underneath, still where it was',
    );

    // And taking somebody out: asked first, and then they are gone from the roster. (An owner
    // cannot be removed, and neither can you — those two are still widget tests, because they are
    // about buttons that are NOT offered.)
    await tap(tester, removeButton, what: 'the remove button on the agent');
    await waitFor(
      tester,
      find.textContaining('remove '),
      what: 'the question, before anybody is removed',
    );
    await tap(
      tester,
      find.widgetWithText(TextButton, 'remove'),
      what: 'confirming it',
    );
    // Gone from the ROSTER, which is not the same as gone from the screen: a one-to-one conversation
    // is titled after the agent, so its name is still up there. What disappears is the only thing
    // that was removable — the button that was on it.
    await waitUntilGone(
      tester,
      removeButton,
      what: 'the agent, out of the conversation',
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

    // The tree is a git repository, and a document's history is the commits behind it. Opening the
    // file we just made and asking for its history has to show the one that created it, with who
    // did it — this journey's own account, which is the only name in this repository.
    await tap(
      tester,
      treeRowFor('inside.md'),
      what: 'the document, to open it',
    );
    await tap(tester, find.byTooltip('history'), what: 'its history');
    await waitFor(
      tester,
      find.text('history of inside.md'),
      what: 'the history',
    );
    // The commit that made this file, named by what it did. (Not by WHO: the repository's author is
    // the account id — `user-37` — not the nickname, which is worth knowing before anybody writes a
    // test expecting a name here.)
    await waitFor(
      tester,
      find.textContaining('inside.md'),
      what: 'the commit that made the file',
    );
    // And the diff behind that commit: a history you cannot open is a list of hashes.
    await tap(
      tester,
      find.textContaining('inside.md').last,
      what: 'the commit, to see what it changed',
    );
    await waitFor(
      tester,
      find.textContaining('diff '),
      what: 'the diff behind it',
    );
    await tap(
      tester,
      find.widgetWithText(TextButton, 'close').last,
      what: 'closing the diff',
    );
    await tap(
      tester,
      find.widgetWithText(TextButton, 'close'),
      what: 'closing the history',
    );

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
    await goToTab(tester, 'agents');
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

    // How often its cache is kept warm: shown in minutes because that is the unit the hour-long
    // cache window is thought about in, sent in seconds because that is what the server takes. From
    // out here the question is simply whether what you typed is what the page then says.
    //
    // The interval is only there once the thing is switched on — and "apply" only once the number
    // has actually changed, because a button that is always there and usually does nothing teaches
    // people to press it and see.
    await tap(
      tester,
      find.text('Keep its cache warm'),
      what: 'the keepalive switch',
    );
    await waitFor(
      tester,
      find.widgetWithText(TextField, 'every'),
      what: 'the interval field',
    );
    await typeInto(tester, find.widgetWithText(TextField, 'every'), '30');
    await tap(tester, find.text('apply'), what: 'apply');
    await waitFor(
      tester,
      find.textContaining('Every 30 min'),
      what: 'the new interval, in minutes',
    );

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

    // --- and now somebody else ----------------------------------------------------------------------
    // Everything above is one person's own things going right. The rules that say what happens to
    // OTHER people — a stranger cannot read your conversation, cannot see your team — never show up
    // in that, because there is nobody else in the run to be refused. So the journey signs a second
    // person up and sends them where the first person has just been.
    //
    // This is the same check the backend makes with a 403, asked the way a person would ask it: go
    // to the address and see what the app gives you. If a leak ever appears, it appears here as the
    // other person's words on the screen — which is the failure worth catching, and the one an
    // assertion about a status code cannot quite state.
    final stranger = await signUp(tester, suffix: 'b');
    await note('signed up a second person ($stranger) to be refused things');

    // Nothing of the first person's is in the second person's own lists.
    await waitUntilGone(
      tester,
      find.text(mine.title),
      what: "the first person's conversation, absent from the stranger's list",
    );
    expect(
      find.text(teamName),
      findsNothing,
      reason: "the stranger's chats list is showing a team they were never in",
    );

    // And the address itself gives them nothing, even typed in directly.
    await go(tester, mine.location);
    expect(
      find.text(mine.said),
      findsNothing,
      reason:
          'a stranger walked straight into somebody else\'s conversation at ${mine.location} and '
          'read what was said in it',
    );
    await note('the stranger was given nothing at ${mine.location}');
    // Twenty-two minutes, and the number is the journey's length rather than a guess: it signs two
    // people up (two real emails, two codes), approves a machine, waits for the real Claude Code to
    // finish its first-run gates, and walks the docs tree. When it outgrew fourteen the drive
    // process was killed mid-wait, which looks like a step that hung rather than a run that ran out
    // — so if this is ever hit, read it as "the journey got longer", not "the app got slower".
  }, timeout: const Timeout(Duration(minutes: 22)));
}

/// The "take this member out" button, found by the prefix of its tooltip.
///
/// The tooltip carries the member's id, which the journey never learns — and does not need to: in a
/// one-to-one conversation the agent is the only member who can be removed at all.
final removeButton = find.byWidgetPredicate(
  (widget) =>
      widget is Tooltip && (widget.message ?? '').startsWith('Remove user '),
  description: 'a remove button',
);

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
/// Get back to the tree from wherever an open document left us.
///
/// On a phone a document is the whole screen; on a wide window the tree is beside it and this is
/// never called.
Future<void> backToTheTree(WidgetTester tester) async {
  final back = find.byTooltip('Back');
  if (back.evaluate().isNotEmpty) {
    await tap(tester, back, what: 'back, to the tree');
    return;
  }
  // No back button on an open document — it keeps the tab bar — so the way back is the product's own
  // rule that tapping the tab you are already on returns it to its root. Which is what a person does
  // here too.
  await tap(
    tester,
    find.byKey(const ValueKey('destination-docs')),
    what: 'the docs tab again, to get back to the tree',
  );
  await tester.pump(const Duration(milliseconds: 500));
}

Future<void> revealIn(
  WidgetTester tester,
  String folder,
  Finder row, {
  required String what,
}) async {
  // Recovery hangs off the FAILURE, not off a check beforehand. On a phone, making a file opens it
  // and the tree it was made in is behind — but the navigation happens a moment after the dialog
  // closes, so any check run first sees the tree still up, concludes there is nothing to recover,
  // and then times out on a page that had already left. Twice I fixed the check and twice it was
  // still looking at the wrong instant. Asking for the tree and dealing with not getting it needs no
  // guess about when the screen changes.
  //
  // On a wide window both panes are visible, the first attempt succeeds, and none of this runs.
  for (var attempt = 0; ; attempt++) {
    try {
      await tapUntil(
        tester,
        treeRowFor(folder),
        row,
        what: 'the row for $folder',
        expecting: what,
      );
      return;
    } catch (_) {
      if (attempt >= 2) rethrow;
      await note('  not looking at the tree — going back to it');
      await backToTheTree(tester);
    }
  }
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
  // Scoped to this row's own subtree, and never with a bare `.first`: a `.first` finder THROWS
  // rather than reporting empty, and on a phone this row is regularly not on screen at all — tapping
  // a file opens it, and the tree it lives in is then behind the document. That threw
  // "Bad state: No element" out of the middle of a finder.
  Finder itsActions() {
    final rows = find.ancestor(
      of: treeRowFor(name),
      matching: find.byType(MouseRegion),
    );
    if (rows.evaluate().isEmpty) {
      return find.byKey(const ValueKey('no row on screen'));
    }
    return find.descendant(of: rows.first, matching: find.byTooltip('actions'));
  }

  // A row's "..." belongs to the row you last touched. On a wide window touching it is enough. On a
  // phone touching a FILE opens it, so the way to have it be the touched row and be looking at the
  // tree is to open it and come back — which is what a person does, and what this does.
  for (
    var attempt = 0;
    attempt < 3 && itsActions().evaluate().isEmpty;
    attempt++
  ) {
    if (treeRowFor(name).evaluate().isEmpty) {
      await backToTheTree(tester);
      continue;
    }
    await tap(tester, treeRowFor(name), what: 'the row for $name');
    await tester.pump(const Duration(milliseconds: 500));
  }
  await waitFor(tester, itsActions(), what: "$name's own actions");
  await tap(tester, itsActions(), what: "$name's actions");
}

/// The shape of a conversation: what is measured rather than reviewed.
///
/// Each of these is a rule the React client already had, and each one is invisible in code review —
/// the numbers in the source agree while the rendered boxes do not. A bubble capped at a flat 560px
/// is the example that started it: correct-looking code, and every bubble filling its row.
Future<void> lookRight(WidgetTester tester) async {
  // The cap only shows itself against text that wants more room than the cap allows. A short
  // message measures its own words — the first cut of this step asserted on one and failed at 83%
  // of the row, which was the sentence being long, not the bubble being uncapped.
  //
  // Unbreakable is the harder half: CSS would not break inside a word, so on the React side a
  // pasted URL or a base64 blob ran straight out of the bubble (T-011). Flutter breaks by
  // character, and this measures that rather than assuming it.
  const wall =
      'A123456789B123456789C123456789D123456789E123456789'
      'F123456789G123456789H123456789I123456789J123456789';
  await typeInto(tester, find.widgetWithText(TextField, 'message…'), wall);
  await tap(
    tester,
    find.widgetWithText(FilledButton, 'send'),
    what: 'send, with a wall of unbreakable text',
  );
  await waitFor(tester, find.text(wall), what: 'the wall in a bubble');

  // Everything below is measured on the conversation's own pane, and the pane is picked by SIZE
  // rather than by position in the tree.
  //
  // On a wide window this text is on screen twice: once in the bubble, and once as the
  // conversation's last line in the list beside it. Both sit inside a ListView, so `.first` takes
  // whichever the tree reaches first, and when that is the 320-wide list of conversations every
  // number below describes the wrong pane — reported as "a bubble 504 wide in a row of 320", which
  // reads exactly like a real defect and is not one. That happened three times: twice against
  // `.first`, and once against a comment of mine claiming `.first` was enough.
  //
  // Rects come from the render tree rather than from finders. A finder built from a render object
  // matches every widget that shares it — thirteen of them here, Scrollable and RepaintBoundary and
  // the rest — and `getRect` then refuses to answer at all. The render object IS the box being
  // measured; going back through a finder to reach it only adds a way to be wrong.
  Rect rectOf(Element element) {
    final box = element.renderObject! as RenderBox;
    return box.localToGlobal(Offset.zero) & box.size;
  }

  final panes = find
      .ancestor(of: find.text(wall), matching: find.byType(ListView))
      .evaluate()
      .map(rectOf)
      .toList();
  final pane = panes.reduce((a, b) => a.width >= b.width ? a : b);
  final row = pane.width;

  // The bubble in THAT pane: of the containers wrapped around this text, the one whose box is
  // inside the conversation.
  final bubble = find
      .ancestor(of: find.text(wall), matching: find.byType(Container))
      .evaluate()
      .map(rectOf)
      .firstWhere(
        (r) => pane.contains(r.center),
        orElse: () =>
            fail('no bubble for the wall inside the conversation pane'),
      );

  // A bubble leaves the sides of the row visible, or nothing can look aligned.
  expect(
    bubble.width,
    lessThanOrEqualTo(row * 0.8),
    reason: 'a bubble ${bubble.width} wide in a row of $row fills it',
  );

  // Own messages sit on the right. (The other half of this rule — theirs on the left, in the other
  // green — needs a second person talking, and stays in a unit test until a journey has one.)
  expect(
    bubble.center.dx,
    greaterThan(pane.center.dx),
    reason: 'own message is not on the right',
  );

  // The conversation's own half of the screen, named by the one thing only it has: the composer.
  // Everything below is scoped to it, for the same reason the pane above was picked by size.
  final conversation = find
      .ancestor(
        of: find.widgetWithText(TextField, 'message…'),
        matching: find.byType(Scaffold),
      )
      .first;
  final inList = find
      .descendant(of: conversation, matching: find.text(wall))
      .first;
  final list = find
      .descendant(of: conversation, matching: find.byType(ListView))
      .first;

  // The green is the one React used. "It went slightly off" is not caught in review.
  final painted = tester
      .widgetList<Container>(
        find.ancestor(of: inList, matching: find.byType(Container)),
      )
      .map((c) => (c.decoration as BoxDecoration?)?.color)
      .whereType<Color>();
  expect(painted, contains(ownBubble), reason: 'the own-message green moved');

  // One area around the list, so a drag can run across bubbles and the system copies what it took.
  expect(find.byType(SelectionArea), findsWidgets);
  expect(
    find.descendant(of: find.byType(SelectionArea), matching: find.text(wall)),
    findsWidgets,
    reason: 'the messages are outside the selection area',
  );

  // A face beside a bubble is the bubble size, not the list size — the two drifted apart once.
  //
  // Only what was PAINTED is asserted. Checking that the constant equals 40 would be reading the
  // constant and comparing it to itself: it cannot fail unless somebody edits both lines together,
  // and a test that cannot fail costs a run and a read and returns nothing.
  for (final avatar in tester.widgetList<UserAvatar>(
    find.descendant(of: list, matching: find.byType(UserAvatar)),
  )) {
    expect(
      avatar.size,
      Metrics.avatarInBubble,
      reason: 'a face beside a bubble is the wrong size',
    );
  }

  // Two controls side by side at different heights: invisible in review, impossible to unsee.
  final field = tester.getSize(find.widgetWithText(TextField, 'message…'));
  final send = tester.getSize(find.widgetWithText(FilledButton, 'send'));
  expect(
    send.height,
    field.height,
    reason: 'send is ${send.height}, the field is ${field.height}',
  );

  // The newest message sits at offset zero, so an arriving message cannot move a reader who has
  // scrolled up. There is nothing to pin, and therefore no pinning rule to get wrong.
  expect(tester.widget<ListView>(list).reverse, isTrue);

  // Picking a conversation beside the list is picking, not navigating — Material would add a back
  // arrow for the history stack, which is a fact about the router and not about this layout.
  if (find.byType(TeamPickerAction).evaluate().isNotEmpty) {
    expect(find.byType(BackButton), findsNothing);
  }

  await note('the conversation still has the shape React gave it');
}
