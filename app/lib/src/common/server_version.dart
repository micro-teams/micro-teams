/// Whether this client and the deployment are the same generation.
///
/// A web client cannot be out of date for long — the launcher asks `/version` on every start and
/// throws its caches away when it disagrees (see tool/launcher.mjs). A native client has no
/// launcher: it was installed once and stays installed, so the only thing that will ever tell it to
/// move is this.
///
/// Only `x.y` counts. Shipping a fix must not lock every installed client out until everybody has
/// updated, and whether a change is a fix or a generation is a decision about the product rather
/// than a fact about the code — so it is expressed by which number moves.
///
/// Not being able to ask is not an answer. Offline, a captive portal, a server mid-deploy: none of
/// those mean the client is stale, and locking somebody out of an app they can otherwise use is
/// worse than letting them run last week's build.
library;

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'build_info.dart';
import '../providers.dart';

/// What the deployment says it is, or null when it could not be asked.
final deployedVersionProvider = FutureProvider<String?>((ref) async {
  if (kIsWeb) return null;
  final endpoints = ref.watch(endpointsProvider);
  try {
    // Its own client and no caching: this is the question a stale client asks about itself, and an
    // answer from a cache is an answer about the past.
    final http = Dio(
      BaseOptions(
        validateStatus: (_) => true,
        headers: const {'Cache-Control': 'no-cache'},
        receiveTimeout: const Duration(seconds: 10),
      ),
    );
    final response = await http.get<String>(
      '${endpoints.origin}/version',
      options: Options(responseType: ResponseType.plain),
    );
    if ((response.statusCode ?? 0) >= 400) return null;
    final deployed = (response.data ?? '').trim();
    return deployed.isEmpty ? null : deployed;
  } catch (_) {
    return null;
  }
});

/// The version this client must move to, or null when it may carry on.
final mustUpdateToProvider = Provider<String?>((ref) {
  if (kIsWeb) return null;
  final mine = currentBuild();
  // An unstamped build is somebody's own `flutter run`; telling them to go and download the app
  // would be telling them to discard the thing they are working on.
  if (mine.version.isEmpty) return null;

  final deployed = ref.watch(deployedVersionProvider).valueOrNull;
  if (deployed == null) return null;
  return BuildInfo.familyOf(deployed) == mine.family ? null : deployed;
});
