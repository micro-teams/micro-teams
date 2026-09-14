/// What this build is, as the build itself knows it.
///
/// Everything here is written at compile time. That is the point: a client that asks the server
/// what it is gets an answer about the server, and the question people actually have — "which one
/// am I running, and is it the same one as everybody else?" — can only be answered by the artefact
/// itself.
///
/// The web has a second, authoritative copy of the version in the launcher, checked against
/// `/version` on every start (see tool/launcher.mjs). A native client has no launcher and no
/// service worker, so this is all it has, and the version check at startup is what makes it
/// enough.
library;

import 'package:flutter/foundation.dart';

/// The single place in this repository that names a deployment.
///
/// Every other layer takes an origin from somewhere: the web reads the page's own URL, a native
/// client reads what the person typed at sign-in. This is only the value that field starts with,
/// and it exists because a first-run native client has to offer something rather than an empty box.
const String defaultServer = 'https://microteams.app';

class BuildInfo {
  const BuildInfo({
    required this.version,
    required this.builtAt,
    required this.platform,
    required this.flavour,
  });

  /// `x.y.z-hash`, the same string the launcher carries, /version serves and the worker is stamped
  /// with. Empty in a build nobody stamped — a local `flutter run`, which is exactly when it does
  /// not matter.
  final String version;

  /// ISO-8601, from the build. Empty when unstamped.
  final String builtAt;

  /// "web", "android", "ios", … — what this artefact runs on, not what it was built on.
  final String platform;

  /// "release" or "debug". Worth showing: a debug build's performance is nobody's evidence about
  /// anything, and people do report against them.
  final String flavour;

  /// The product half of the version — the `x.y` of `x.y.z-hash`.
  ///
  /// This is what a client compares against the server's. The patch and the commit deliberately do
  /// not count: shipping a fix must not lock every client out until they have all updated, and
  /// that is a decision about how the product is released rather than a fact about the code.
  String get family => familyOf(version);

  static String familyOf(String version) {
    final parts = version.split('-').first.split('.');
    return parts.length >= 2 ? '${parts[0]}.${parts[1]}' : version;
  }
}

/// This build, from the values CI passed in.
BuildInfo currentBuild() => BuildInfo(
  version: const String.fromEnvironment('MT_VERSION'),
  builtAt: const String.fromEnvironment('MT_BUILT_AT'),
  platform: kIsWeb ? 'web' : defaultTargetPlatform.name,
  flavour: kDebugMode ? 'debug' : 'release',
);
