/// What clients this deployment offers, as the deployment itself says.
///
/// Written by the build into `/downloads/clients.json` beside the packages themselves, so the list
/// on screen and the files on disk cannot disagree: nothing here knows the name of an artefact, and
/// adding an architecture is a line in that file rather than a change to this one.
library;

import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers.dart';

/// One downloadable client.
class ClientPackage {
  const ClientPackage({
    required this.platform,
    required this.arch,
    required this.url,
    required this.bytes,
    required this.signed,
  });

  final String platform;
  final String arch;

  /// Origin-relative, so the file comes from whichever host this client is talking to.
  final String url;

  final int bytes;

  /// How it was signed. "release" is our key; "debug" is the key Android's toolchain invents when
  /// no key was supplied, and it is worth saying out loud — a package signed with it cannot be
  /// updated in place by one signed with any other.
  final String signed;

  String get name => '$platform $arch';

  String get size =>
      bytes <= 0 ? '' : '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';

  static ClientPackage? fromJson(Object? raw) {
    if (raw is! Map) return null;
    final url = raw['url'];
    if (url is! String || url.isEmpty) return null;
    return ClientPackage(
      platform: '${raw['platform'] ?? ''}',
      arch: '${raw['arch'] ?? ''}',
      url: url,
      bytes: raw['bytes'] is num ? (raw['bytes'] as num).toInt() : 0,
      signed: '${raw['signed'] ?? ''}',
    );
  }
}

/// The list, or empty when this deployment ships no packages.
///
/// Empty rather than an error on purpose: a deployment with no clients built yet is an ordinary
/// state, and the screen that shows this has plenty to say without it.
final clientPackagesProvider = FutureProvider<List<ClientPackage>>((ref) async {
  final endpoints = ref.watch(endpointsProvider);
  try {
    // Its own client, not the app's: this is a file sitting beside the application, not an API
    // call. The app's client would attach a token it does not need, route it over a line chosen for
    // requests, and record the answer in the read cache — none of which a static manifest wants.
    final http = Dio(BaseOptions(validateStatus: (_) => true));
    final response = await http.get<String>(
      '${endpoints.origin}/downloads/clients.json',
      options: Options(responseType: ResponseType.plain),
    );
    if ((response.statusCode ?? 0) >= 400) return const [];
    final parsed = jsonDecode(response.data ?? '');
    if (parsed is! Map) return const [];
    final clients = parsed['clients'];
    if (clients is! List) return const [];
    return [
      for (final raw in clients)
        if (ClientPackage.fromJson(raw) case final client?) client,
    ];
  } catch (_) {
    return const [];
  }
});
