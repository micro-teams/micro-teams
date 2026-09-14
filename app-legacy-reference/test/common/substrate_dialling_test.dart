// The Dart mirror of the bug the web worker found in its own, now-deleted reimplementation of this
// idea: `_dialling` guards against a concurrent dial, and it must come back off on failure or the
// substrate is gone for the rest of the session after the very first bad-luck attempt.
//
// app.dart's own registry-fetch calls reset() once at startup, which used to be the only thing
// clearing this flag — masking the bug as long as THAT one attempt never lost the race. A freshly
// started deployment does not guarantee every container is ready for connections the instant its
// healthcheck passes, so a first dial losing that race, while the deployment is healthy a moment
// later, is not a hypothetical.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:microteams/src/common/multipath_adapter.dart';
import 'package:multipath/multipath.dart' as mp;

void main() {
  test(
    'a failed dial is retried on the next request, not abandoned forever',
    () async {
      var calls = 0;
      var succeed = false;
      final substrate = Substrate(
        lines: const ['http://x.test'],
        dial: (_) {
          calls++;
          if (!succeed) throw StateError('all links failed to connect');
          return _FakeClient();
        },
      );

      substrate.clientOrStartDialling();
      await Future<void>.delayed(const Duration(milliseconds: 10));
      expect(calls, 1, reason: 'first attempt');

      substrate.clientOrStartDialling();
      await Future<void>.delayed(const Duration(milliseconds: 10));
      expect(
        calls,
        2,
        reason:
            'a second triggering call must try again after the first failed',
      );

      succeed = true;
      substrate.clientOrStartDialling();
      await Future<void>.delayed(const Duration(milliseconds: 10));
      expect(calls, 3);
      expect(substrate.clientOrStartDialling(), isNotNull);
    },
  );
}

class _FakeClient implements mp.Client {
  @override
  dynamic noSuchMethod(Invocation invocation) => null;
}
