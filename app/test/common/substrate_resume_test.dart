// Proves the app-resume half of the Android background bug: Android can suspend a backgrounded
// process in a way that silently kills the substrate's `mp.Client` (its own reconnect logic is
// time-driven and depends on Dart Timers that a frozen process cannot run, and a half-open TCP
// socket does not error on write — see app.dart's resumed handler for the full reasoning).
// `clientOrStartDialling()`/`live` used to keep handing out the SAME client forever once dialled,
// because nothing but the one-time startup registry fetch ever called `reset()`. This is the Dart
// mirror of `substrate_dialling_test.dart`, but for the "resume" trigger instead of "dial failed".
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:microteams/src/common/multipath_adapter.dart';
import 'package:multipath/multipath.dart' as mp;

void main() {
  test('reset() on resume replaces a previously-dialled client with a fresh one, '
      'not the same one forever', () async {
    var calls = 0;
    final clients = <_FakeClient>[];
    final substrate = Substrate(
      lines: const ['http://x.test'],
      dial: (_) {
        calls++;
        final client = _FakeClient();
        clients.add(client);
        return client;
      },
    );

    // The ordinary case: a request dials, and the app goes on using that one client for every
    // later request and socket-open — exactly how a live-for-hours client is meant to behave.
    substrate.clientOrStartDialling();
    await Future<void>.delayed(const Duration(milliseconds: 10));
    expect(calls, 1);
    final firstClient = substrate.live;
    expect(firstClient, same(clients[0]));

    substrate.clientOrStartDialling();
    expect(
      substrate.live,
      same(firstClient),
      reason:
          'a second call while the client is fine must reuse it, not '
          'redial',
    );

    // The app is backgrounded, and — per the hypothesis this test exists to pin down — the OS
    // silently kills the client's transport with no error or close event ever reaching it. There
    // is nothing observable here that distinguishes it from a perfectly healthy client: this
    // fake, like the real one after the freeze, just sits there. The only thing that can end this
    // is app.dart's resume handler calling reset() unconditionally.
    substrate.reset();

    expect(
      substrate.live,
      isNull,
      reason:
          'immediately after reset the old client must be gone, so the '
          'next caller (an HTTP request via clientOrStartDialling, or a '
          'socket via live) falls back to an ordinary, un-multiplexed '
          'connection rather than being handed the dead one',
    );

    substrate.clientOrStartDialling();
    await Future<void>.delayed(const Duration(milliseconds: 10));

    expect(calls, 2, reason: 'resume must force a fresh dial');
    expect(
      substrate.live,
      isNot(same(firstClient)),
      reason:
          'the client handed out after resume must not be the one from '
          'before backgrounding',
    );
    expect(
      (firstClient as _FakeClient?)?.closed,
      isTrue,
      reason: 'the old client is torn down, not leaked',
    );
  });
}

class _FakeClient implements mp.Client {
  bool closed = false;

  @override
  void close() {
    closed = true;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => null;
}
