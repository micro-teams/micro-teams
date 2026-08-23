// The shelf MultiPath keeps its line measurements on, and what a visit inherits from the last one.

import 'package:flutter_test/flutter_test.dart';
import 'package:microteams/src/common/prefs_store.dart';
import 'package:multipath/multipath.dart';
import 'package:shared_preferences/shared_preferences.dart';

Registry _two() => parseRegistry({
  'lines': [
    {'id': 'origin', 'url': ''},
    {'id': 'relay', 'url': 'https://relay.example.com'},
  ],
});

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('the second visit ranks on what the first measured', () async {
    final first = LineManager(
      registry: _two(),
      storage: const PrefsHealthStore(),
    );
    // The relay answers; the origin does not. Real traffic is a measurement like any other.
    await first.read((line, {required cancelled}) async {
      if (line.id == 'origin') throw StateError('down');
      return line.id;
    });
    await first.saveHealth();

    final second = LineManager(
      registry: _two(),
      storage: const PrefsHealthStore(),
    );
    await second.restoreHealth();
    expect(second.ranked.first.id, 'relay');
    expect(
      second.health['origin'].state,
      LineState.up,
      reason: 'a line unreachable last visit must not start this one demoted',
    );
  });

  test(
    'a first visit has nothing to inherit and says nothing about it',
    () async {
      final manager = LineManager(
        registry: _two(),
        storage: const PrefsHealthStore(),
      );
      await manager.restoreHealth();
      expect(manager.preferredLineIds, [
        'origin',
        'relay',
      ], reason: 'with nothing measured, the registry order stands');
    },
  );
}
