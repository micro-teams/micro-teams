// The rules about shape, enforced by reading the source.
//
// Two of them, and each exists because the React client broke it once.
//
// A screen renders state and reports intent. It does not fetch, does not hold a client, and does
// not subscribe. That one had to grow a custom lint over there (PR #162): screens had accumulated
// their own API calls, so the same fetch existed in the phone layout and the desktop layout and
// drifted apart.
//
// The tree is arranged by BUSINESS AREA, not by layer — chats/, agents/, terminal/, auth/ —
// with common/ for the things that belong to no area. That matches the backend, and it means the
// files you change together live together. What keeps it honest is direction: common/ may not know
// what a chat is, and a feature may not reach into another feature. When two features want the same
// thing it goes to common/; when it will not go, that is the answer — it was not shared.

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Files that are allowed to know the network exists.
const _plumbing = {
  'lib/src/common/api.dart',
  // Where a deployment is named, once — see the test below.
  'lib/src/common/build_info.dart',
  'lib/src/common/lines.dart',
  'lib/src/common/multipath_adapter.dart',
  'lib/src/common/config.dart',
  'lib/src/common/updates/socket.dart',
  'lib/src/auth/auth_api.dart',
  'lib/src/providers.dart',
};

/// The business areas. Anything not here is common/ or the composition root.
const _features = ['chats', 'agents', 'terminal', 'auth'];

List<File> _dartFiles(String dir) => Directory(dir)
    .listSync(recursive: true)
    .whereType<File>()
    .where((f) => f.path.endsWith('.dart'))
    .toList();

/// The import targets of one file, as written.
List<String> _importsOf(File file) => RegExp(
  r"""^\s*import\s+['"]([^'"]+)['"]""",
  multiLine: true,
).allMatches(file.readAsStringSync()).map((m) => m.group(1)!).toList();

void main() {
  test('no screen talks to a server', () {
    final offenders = <String>[];

    for (final file in _dartFiles('lib/src')) {
      final path = file.path;
      if (!path.endsWith('_screen.dart')) continue;
      final source = file.readAsStringSync();

      if (source.contains('mtCall(')) {
        offenders.add('$path calls mtCall — move the fetch into a controller');
      }
      if (source.contains('common/api.dart')) {
        offenders.add('$path imports the nt client directly');
      }
      if (source.contains('watchTopic(')) {
        offenders.add(
          '$path subscribes to a topic — a screen that can hold data is a '
          'second path to the pixels',
        );
      }
    }

    expect(offenders, isEmpty, reason: offenders.join('\n'));
  });

  test('only the plumbing knows where the server is', () {
    final offenders = <String>[];

    for (final file in _dartFiles('lib/src')) {
      final path = file.path;
      if (_plumbing.contains(path)) continue;
      final source = file.readAsStringSync();
      // A hostname or a hard-coded /mt path anywhere else means a request that cannot be routed,
      // re-pointed, or tested against a fake.
      if (RegExp(r"'https?://").hasMatch(source)) {
        offenders.add('$path hard-codes a URL');
      }
    }

    expect(offenders, isEmpty, reason: offenders.join('\n'));
  });

  test('one deployment is named, in one place', () {
    // A native client is installed rather than served, so it has to start SOMEWHERE, and that
    // somewhere is a hostname written into the source. One is a default; two is a pair that will
    // disagree — and the day they disagree, half the app talks to one server and half to the other.
    final naming = <String>[];
    for (final file in _dartFiles('lib')) {
      if (file.readAsStringSync().contains('microteams.app')) {
        naming.add(file.path);
      }
    }

    expect(naming, [
      'lib/src/common/build_info.dart',
    ], reason: naming.join('\n'));
  });

  test('common/ does not know what a chat is', () {
    // The direction that makes "common" mean anything. The moment something in common/ imports a
    // feature, it is not common — it is that feature's, sitting in the wrong place, and every other
    // feature now depends on it transitively.
    final offenders = <String>[];

    for (final file in _dartFiles('lib/src/common')) {
      for (final target in _importsOf(file)) {
        for (final feature in _features) {
          if (target.contains('/$feature/') ||
              target.startsWith('../$feature/')) {
            offenders.add('${file.path} imports $target');
          }
        }
      }
    }

    expect(offenders, isEmpty, reason: offenders.join('\n'));
  });

  test('features do not reach into each other', () {
    // Not a style preference: a chat screen importing an agents file is how two areas become one
    // area that nobody decided to merge. When both want the same thing, it goes to common/ — and if
    // it will not go there without dragging half a feature with it, that is the answer.
    //
    // The composition root (providers.dart, app.dart) is exempt: wiring features together is its
    // entire job, and it is the one place where that is visible.
    final offenders = <String>[];

    for (final feature in _features) {
      for (final file in _dartFiles('lib/src/$feature')) {
        for (final target in _importsOf(file)) {
          for (final other in _features) {
            if (other == feature) continue;
            if (target.contains('../$other/')) {
              offenders.add('${file.path} imports $target');
            }
          }
        }
      }
    }

    expect(
      offenders,
      isEmpty,
      reason:
          '${offenders.join('\n')}\n'
          'Move the shared thing into lib/src/common/, or accept that it was not shared.',
    );
  });

  test('every source file lives in a business area or in common', () {
    // A file at the top of lib/src/ is a file nobody has decided the owner of, and that is where a
    // "utils" directory starts.
    const allowed = {'lib/src/app.dart', 'lib/src/providers.dart'};
    final offenders = <String>[];

    for (final file in Directory('lib/src').listSync().whereType<File>()) {
      if (!file.path.endsWith('.dart')) continue;
      if (allowed.contains(file.path)) continue;
      offenders.add(file.path);
    }

    expect(
      offenders,
      isEmpty,
      reason:
          '${offenders.join('\n')}\n'
          'Put it under the feature that owns it, or under common/ if no feature does.',
    );
  });

  test('the generated client cannot be committed, so it cannot be edited', () {
    // The strongest available guarantee that nobody "just fixes" a generated model: the whole
    // package is ignored, so an edit cannot survive a checkout. Same arrangement as
    // frontend/src/api had on the TypeScript side.
    final ignore = File('.gitignore').readAsStringSync();
    expect(
      ignore.contains('packages/mt_api/'),
      isTrue,
      reason:
          'app/.gitignore must ignore packages/mt_api/ — it is generated by tool/codegen.sh from '
          'the repo-root contract, and a committed copy is one that can drift from it',
    );
  });
  test('every provider holding one account\'s answers is dropped on sign-out', () {
    // The rule: a controller that has fetched is a place the previous account's data lives, and it
    // outlives a sign-out because none of these are autoDispose. Clearing the request cache and the
    // outbox is not enough — the journey caught a second person reading the first person's
    // conversation off a controller that was still holding it, while the server refused every
    // request behind it with a 403.
    //
    // So the list in providers.dart has to stay complete. This test is what stops it rotting: add a
    // provider to a feature or to common/, and either name it there or exempt it here, with why.
    const exempt = {
      // Nothing to do with an account: what this deployment is, and what the server can do.
      'clientPackagesProvider',
      'deployedVersionProvider',
      'mustUpdateToProvider',
      'endpointsProvider',
      'serverProvider',
      'requestCacheProvider',
      'stateStoreProvider',
      'linesProvider',
      'authApiProvider',
      'probeLinesProvider',
      'mtClientProvider',
      'updatesStoreProvider', 'streamLinesProvider', 'updatesSocketProvider',
      // The session itself, and the team you picked. Both are set by the sign-in that follows.
      'sessionProvider', 'selectedTeamProvider',
    };

    final listed = RegExp(r'^\s{2}(\w+Provider),\s*$', multiLine: true)
        .allMatches(File('lib/src/providers.dart').readAsStringSync())
        .map((m) => m.group(1)!)
        .toSet();

    final missing = <String>[];
    for (final file in _dartFiles('lib/src')) {
      for (final m in RegExp(
        r'^final (\w+Provider)\s*=',
        multiLine: true,
      ).allMatches(file.readAsStringSync())) {
        final name = m.group(1)!;
        if (listed.contains(name) || exempt.contains(name)) continue;
        missing.add(
          '${file.path}: $name is neither dropped on sign-out nor exempt',
        );
      }
    }

    expect(missing, isEmpty, reason: missing.join('\n'));
  });
}
